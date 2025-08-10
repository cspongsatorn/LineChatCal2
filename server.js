import express from 'express';
import axios from 'axios';
import vision from '@google-cloud/vision';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// Google Vision Client
const visionClient = new vision.ImageAnnotatorClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS)
});

// ฟังก์ชันดึงภาพจาก LINE
async function getImageFromLine(messageId) {
  const res = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: { Authorization: `Bearer ${LINE_TOKEN}` },
      responseType: 'arraybuffer'
    }
  );
  return res.data;
}

// ฟังก์ชันประมวลผลข้อความจาก OCR → สรุปยอด
function parseSummary(text) {
  console.log("text ORIGIN", text);
  // แปลงข้อความ OCR เป็น array ทีละบรรทัด
  let lines = text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  console.log("OCR Lines ver: 2.1", lines);

  // แก้ปัญหากรณีตัวเลขติดกันใน 1 cell
  lines = lines.flatMap(item => {
    if (/^\d+\s+\d+$/.test(item)) {
      return item.split(/\s+/);
    }
    return item;
  });

  // หา header index
  const headerIndex = lines.findIndex(l => l.includes('แผนก'));
  if (headerIndex === -1) return 'ไม่พบหัวตารางแผนก';

  // เอา header และข้อมูล
  const headers = ['แผนก', 'ยอดวันนี้', 'ยอดที่ต้องการ'];
  let rawData = lines.slice(headerIndex + 1);

  let dataRows = [];
  for (let i = 0; i < rawData.length; i += headers.length) {
    let row = {};
    headers.forEach((h, idx) => {
      row[h] = rawData[i + idx] || '';
    });
    dataRows.push(row);
  }

  if (!dataRows.length) return 'ไม่พบข้อมูลแผนก';

  // สร้างข้อความสรุป
  let message = '📊 สรุปยอดประจำ\n';
  dataRows.forEach(row => {
    const today = parseInt(row['ยอดวันนี้'].replace(/[^\d]/g, ''), 10) || 0;
    const target = parseInt(row['ยอดที่ต้องการ'].replace(/[^\d]/g, ''), 10) || 0;
    const diff = today - target;
    message += `\nแผนก ${row['แผนก']}\n`;
    message += `ยอดวันนี้: ${today}\n`;
    message += `ยอดที่ต้องการ: ${target}\n`;
    message += `เป้า/ขาดทุน: ${diff} บาท\n`;
  });

  return message;
}

// ฟังก์ชันส่งข้อความกลับไปทาง LINE
async function replyMessage(replyToken, text) {
  await axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken,
    messages: [{ type: 'text', text }]
  }, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` }
  });
}

// Webhook
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'image') {
        try {
          const imgBuffer = await getImageFromLine(event.message.id);
          const [result] = await visionClient.textDetection({ image: { content: imgBuffer } });
          const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : '';
          const summary = parseSummary(text);
          await replyMessage(event.replyToken, summary || 'ไม่พบข้อมูลในภาพค่ะ');
        } catch (err) {
          console.error('Error processing image:', err);
          await replyMessage(event.replyToken, 'เกิดข้อผิดพลาดในการประมวลผลภาพค่ะ');
        }
      } else {
        await replyMessage(event.replyToken, 'กรุณาส่งภาพตารางยอดค่ะ');
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200); // ตอบ 200 เพื่อไม่ให้ LINE retry
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
