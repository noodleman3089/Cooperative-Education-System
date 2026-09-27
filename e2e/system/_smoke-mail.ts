/**
 * ทดสอบส่งเมลจริงผ่าน SMTP sink ในเครื่อง — ใช้ตอนอัป nodemailer / mail library
 *
 * วิธีรัน (จาก root · Node 26 รัน .ts ได้เองโดยตัด type ทิ้ง):
 *   npm.cmd --prefix backend run build
 *   node e2e/system/_smoke-mail.ts
 *
 * ⛔ import ตัวที่ build แล้วใน backend/dist ไม่ใช่ src — Node ตีไฟล์นี้เป็น ESM และ src ของ backend
 *    import กันแบบไม่มีนามสกุล ESM loader หาไม่เจอ (`ts-node` ก็พังด้วย ERR_UNSUPPORTED_ESM_URL_SCHEME)
 *    แก้ utils/email.ts แล้วต้อง build ก่อนรัน ไม่งั้นทดสอบของเก่า
 */
import fs from 'fs';
import net from 'net';
import dotenv from 'dotenv';

const BACKEND = new URL('../../backend/', import.meta.url);
dotenv.config({ path: new URL('.env', BACKEND) });

/** Minimal SMTP sink: enough of the protocol for nodemailer to complete a send. */
function startSink(port: number) {
  const received: string[] = [];
  const server = net.createServer((sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 localhost ESMTP sink\r\n');
    sock.on('data', (chunk) => {
      const s = chunk.toString();
      if (inData) {
        buf += s;
        if (buf.includes('\r\n.\r\n')) {
          received.push(buf);
          inData = false;
          buf = '';
          sock.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of s.split('\r\n').filter(Boolean)) {
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) {
          sock.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        } else if (cmd.startsWith('AUTH')) sock.write('235 OK\r\n');
        else if (cmd.startsWith('MAIL FROM')) sock.write('250 OK\r\n');
        else if (cmd.startsWith('RCPT TO')) sock.write('250 OK\r\n');
        else if (cmd.startsWith('DATA')) {
          inData = true;
          sock.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (cmd.startsWith('QUIT')) {
          sock.write('221 Bye\r\n');
          sock.end();
        } else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise<{ server: net.Server; received: string[] }>((res) =>
    server.listen(port, '127.0.0.1', () => res({ server, received }))
  );
}

function decodeBody(raw: string) {
  const encMatch = raw.match(/Content-Transfer-Encoding:\s*(\S+)/i);
  const enc = encMatch ? encMatch[1].toLowerCase() : 'none';
  const parts = raw.split('\r\n\r\n');
  const bodyRaw = parts.slice(1).join('\r\n\r\n');
  if (enc === 'base64') {
    return { enc, body: Buffer.from(bodyRaw.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8') };
  }
  if (enc === 'quoted-printable') {
    const unfolded = bodyRaw.replace(/=\r\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < unfolded.length; i++) {
      if (unfolded[i] === '=' && /[0-9A-Fa-f]{2}/.test(unfolded.substr(i + 1, 2))) {
        bytes.push(parseInt(unfolded.substr(i + 1, 2), 16));
        i += 2;
      } else {
        bytes.push(unfolded.charCodeAt(i));
      }
    }
    return { enc, body: Buffer.from(bytes).toString('utf8') };
  }
  return { enc, body: bodyRaw };
}

async function main() {
  const PORT = 2599;
  const { server, received } = await startSink(PORT);

  // Point the real module at the sink BEFORE importing it — the transporter is
  // built at module load.
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(PORT);
  process.env.SMTP_USER = 'u';
  process.env.SMTP_PASS = 'p';
  process.env.SMTP_FROM = 'coop-system@rmutto.ac.th';

  const emailJs = new URL('dist/utils/email.js', BACKEND);
  if (!fs.existsSync(emailJs)) throw new Error('ไม่พบ backend/dist — รัน npm.cmd --prefix backend run build ก่อน');
  const email = await import(emailJs.href);

  await email.sendCompanyInviteEmail('hr@example.com', 'https://example.com/login/company?token=abc');
  await email.sendMentorInviteEmail('mentor@example.com', 'https://example.com/login/company?token=def');

  await new Promise((r) => setTimeout(r, 500));
  server.close();

  const report = received.map((raw) => {
    const { enc, body } = decodeBody(raw);
    return {
      to: (raw.match(/^To:\s*(.*)$/m) || [])[1],
      encoding: enc,
      subjectUtf8: /Subject:\s*=\?UTF-8\?/i.test(raw),
      hasThai: /[\u0E00-\u0E7F]/.test(body),
      hasInviteLink: body.includes('token='),
    };
  });

  console.log(JSON.stringify({ messagesReceived: received.length, report }, null, 1));
  const ok = received.length === 2 && report.every((r) => r.hasThai && r.hasInviteLink && r.subjectUtf8);
  console.log(ok ? 'SMOKE OK' : 'SMOKE INCOMPLETE');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
