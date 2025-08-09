import express from 'express';
import axios from 'axios';
import vision from '@google-cloud/vision';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// สร้าง Vision Client จาก ENV
const visionClient = new vision.ImageAnnotatorClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS)
});

// ดึงรูปจาก LINE
async function getImageFromLine(messageId) {
  const res = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` },
    responseType: 'arraybuffer'
  });
  return res.data;
}

// วิเคราะห์ข้อความจากรูป พร้อม log ผล OCR lines
function parseSummary(text) {
  // แปลงข้อความ OCR เป็น array แถว
  const lines = text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  console.log("OCR Lines:", lines);

  // คาดว่า lines จะมีลักษณะเป็นแถว เช่น
  // ['แผนก ยอดวันนี้ ยอดที่ต้องการ', 'IT 1200 2000', 'COM 5000 11000']

  // หาแถว header ที่มีคำว่า 'แผนก' เพื่อข้าม
  const headerIndex = lines.findIndex(line => line.includes('แผนก'));
  if (headerIndex === -1) return 'ไม่พบหัวตารางแผนก';

  let summary = [];
  let date = ''; // ไม่มีวันที่ในตัวอย่างนี้

  // เริ่มอ่านข้อมูลจากแถวหลัง header
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cols = lines[i].split(' ').filter(Boolean);

    // สมมติโครงสร้าง: [แผนก, ยอดวันนี้, ยอดที่ต้องการ]
    if (cols.length >= 3) {
      const dept = cols[0];
      const today = parseInt(cols[1].replace(/[^\d]/g, ''), 10) || 0;
      const target = parseInt(cols[2].replace(/[^\d]/g, ''), 10) || 0;
      const diff = today - target;
      summary.push(`แผนก ${dept} ยอดวันนี้ ${today} ยอดที่ต้องการ ${target} เป้า/ขาดทุน ${diff} บาท`);
    }
  }

  return `สรุปยอดประจำ${date}\n` + (summary.length ? summary.join('\n') : 'ไม่พบข้อมูลแผนก');
}

// ส่งข้อความกลับ LINE
async function replyMessage(replyToken, text) {
  await axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken,
    messages: [{ type: 'text', text }]
  }, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` }
  });
}

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
    res.sendStatus(200);  // ตอบ 200 เพื่อไม่ให้ LINE retry เยอะ
  }
});

const PORT = 10000 || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
