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
  const lines = text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  console.log("OCR Lines:", lines);

  let summary = [];
  let date = ''; // ไม่มีวันที่ใน OCR นี้ เลยไม่ใส่

  // หา index ของคำว่า 'แผนก' เป็น header
  const headerIndex = lines.findIndex(line => line.includes('แผนก'));
  if (headerIndex === -1) return 'ไม่พบข้อมูลแผนก';

  // สมมติข้อมูลจริงเริ่มที่ headerIndex+1
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const dept = lines[i];
    const todayLine = lines[i + 1] || '';
    const targetLine = lines[i + 2] || '';

    // กรณีข้อมูลที่รวมกัน เช่น '5000 11000' ให้แยกตัวเลข
    let today = 0, target = 0;

    // ถ้า targetLine มี 2 ตัวเลข เช่น '5000 11000'
    const nums = targetLine.match(/\d+/g);
    if (nums && nums.length >= 2) {
      today = parseInt(nums[0], 10);
      target = parseInt(nums[1], 10);
      i += 2; // ข้ามไปเลย 2 บรรทัด
    } else {
      today = parseInt(todayLine.replace(/[^\d]/g, ''), 10) || 0;
      target = parseInt(targetLine.replace(/[^\d]/g, ''), 10) || 0;
      i += 2; // ข้าม 2 บรรทัด
    }

    if (dept && today && target) {
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
