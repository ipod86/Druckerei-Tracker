'use strict';

const PDFDocument = require('pdfkit');
const { PDFDocument: LibPDFDocument } = require('pdf-lib');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str.includes('T') || str.includes('Z') ? str : str.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return str;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function generateSummaryPDF(cardId) {
  const card = db.prepare(`
    SELECT ca.*, col.name as column_name, g.name as group_name,
           cu.name as customer_name, co.name as customer_company,
           u.username as created_by_name
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    LEFT JOIN companies co ON cu.company_id = co.id
    LEFT JOIN users u ON ca.created_by = u.id
    WHERE ca.id = ?
  `).get(cardId);

  if (!card) throw new Error('Card not found');

  const labels = db.prepare(`
    SELECT l.name, l.color FROM labels l
    JOIN card_labels cl ON l.id = cl.label_id WHERE cl.card_id = ?
  `).all(cardId);

  const checklists = db.prepare('SELECT * FROM checklists WHERE card_id = ? ORDER BY order_index').all(cardId);
  for (const cl of checklists) {
    cl.items = db.prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY order_index').all(cl.id);
  }

  const history = db.prepare(`
    SELECT ch.*, u.username FROM card_history ch
    LEFT JOIN users u ON ch.user_id = u.id
    WHERE ch.card_id = ? ORDER BY ch.created_at
  `).all(cardId);

  const colNameCache = new Map();
  const getColName = id => {
    if (!id) return null;
    if (!colNameCache.has(id)) {
      const col = db.prepare('SELECT name FROM columns WHERE id = ?').get(id);
      colNameCache.set(id, col ? col.name : String(id));
    }
    return colNameCache.get(id);
  };
  for (const h of history) {
    if (h.action_type === 'moved' && h.details) {
      try {
        const d = JSON.parse(h.details);
        if (d.from_column_id) d.from_column_name = getColName(d.from_column_id);
        if (d.to_column_id)   d.to_column_name   = getColName(d.to_column_id);
        h.details = JSON.stringify(d);
      } catch {}
    }
  }

  const comments = db.prepare(`
    SELECT cc.*, u.username FROM card_comments cc
    LEFT JOIN users u ON cc.user_id = u.id
    WHERE cc.card_id = ? ORDER BY cc.created_at
  `).all(cardId);

  const transitionValues = db.prepare(`
    SELECT tv.value, tv.created_at, tf.field_name, tf.field_type,
           u.username,
           gf.name as from_group_name
    FROM transition_values tv
    JOIN transition_fields tf ON tv.field_id = tf.id
    LEFT JOIN users u ON tv.user_id = u.id
    LEFT JOIN groups gf ON tf.from_group_id = gf.id
    WHERE tv.card_id = ?
    ORDER BY tv.created_at
  `).all(cardId);

  const files = db.prepare('SELECT * FROM card_files WHERE card_id = ?').all(cardId);
  const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');

  const settings = db.prepare('SELECT key, value FROM settings').all();
  const sObj = {};
  for (const s of settings) sObj[s.key] = s.value;
  const appName = sObj.app_name || 'Druckerei Tracker';

  // Check if logo exists
  const logoPath = path.join(uploadPath, 'branding', 'logo.png');
  const hasLogo = fs.existsSync(logoPath);

  // Create pdfkit document
  const pdfkitBuffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const leftMargin = doc.page.margins.left;
    const rightMargin = doc.page.margins.right;
    const contentWidth = doc.page.width - leftMargin - rightMargin;

    // ── Header ──────────────────────────────────────────────────────────────
    let headerY = doc.page.margins.top;

    if (hasLogo) {
      try {
        doc.image(logoPath, leftMargin, headerY, { height: 40, fit: [160, 40] });
        doc.y = headerY + 48;
      } catch (e) {}
    }

    // Thin colored top border line
    const primaryColor = sObj.primary_color || '#2563eb';
    doc.rect(leftMargin, doc.y, contentWidth, 3).fillColor(primaryColor).fill();
    doc.y += 6;

    // App name + Karten-Zusammenfassung header
    doc.fontSize(9).font('Helvetica').fillColor('#666666')
       .text(appName, leftMargin, doc.y);
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111111')
       .text('Karten-Zusammenfassung', leftMargin);
    doc.moveDown(0.3);

    // Thin separator line
    doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + contentWidth, doc.y)
       .strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // ── Card Title ──────────────────────────────────────────────────────────
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#111111').text(card.title, leftMargin, doc.y, { width: contentWidth });
    if (card.order_number) {
      doc.moveDown(0.2);
      doc.fontSize(11).font('Helvetica').fillColor('#555555').text(`Auftrag Nr. ${card.order_number}`, leftMargin);
    }
    doc.fillColor('#000000');
    doc.moveDown(0.8);

    // ── Meta Grid (letter-style, two-column) ───────────────────────────────
    const labelW = 130;
    const valueX = leftMargin + labelW;
    const valueW = contentWidth - labelW;

    function metaRow(label, value) {
      const rowY = doc.y;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#555555')
         .text(label, leftMargin, rowY, { width: labelW });
      doc.fontSize(10).font('Helvetica').fillColor('#1a1a1a')
         .text(value || '—', valueX, rowY, { width: valueW });
      doc.moveDown(0.15);
    }

    metaRow('Status', `${card.group_name} / ${card.column_name}`);
    metaRow('Kunde', [card.customer_name, card.customer_company].filter(Boolean).join(', ') || null);
    if (card.customer_email) metaRow('Kunden-E-Mail', card.customer_email);
    metaRow('Faelligkeitsdatum', formatDate(card.due_date));
    metaRow('Erstellt von', card.created_by_name || null);
    metaRow('Erstellt am', formatDate(card.created_at));
    if (labels.length > 0) metaRow('Labels', labels.map(l => l.name).join(', '));

    // ── Helper: section heading ─────────────────────────────────────────────
    function sectionHeading(title) {
      doc.moveDown(0.8);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#111111').text(title, leftMargin);
      const y = doc.y + 2;
      doc.moveTo(leftMargin, y).lineTo(leftMargin + contentWidth, y)
         .strokeColor('#bbbbbb').lineWidth(0.7).stroke();
      doc.fillColor('#000000');
      doc.moveDown(0.4);
    }

    // ── Description ─────────────────────────────────────────────────────────
    if (card.description) {
      sectionHeading('Beschreibung');
      doc.fontSize(11).font('Helvetica').fillColor('#1a1a1a')
         .text(card.description, leftMargin, doc.y, { width: contentWidth });
    }

    // ── Transition Values ────────────────────────────────────────────────────
    if (transitionValues.length > 0) {
      sectionHeading('Uebergabewerte');
      const tvGroups = {};
      for (const tv of transitionValues) {
        const key = tv.from_group_name || 'Allgemein';
        if (!tvGroups[key]) tvGroups[key] = [];
        tvGroups[key].push(tv);
      }

      for (const [groupName, entries] of Object.entries(tvGroups)) {
        doc.moveDown(0.4);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#444444')
           .text(`Uebergabe aus ${groupName}`, leftMargin);
        doc.fillColor('#000000');
        doc.moveDown(0.2);

        for (const tv of entries) {
          const rowY = doc.y;
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888')
             .text(tv.field_name, leftMargin, rowY, { width: labelW });
          doc.fontSize(10).font('Helvetica').fillColor('#1a1a1a')
             .text(tv.value || '—', valueX, rowY, { width: valueW });
          doc.moveDown(0.15);
        }
      }
    }

    // ── Checklists ───────────────────────────────────────────────────────────
    if (checklists.length > 0) {
      sectionHeading('Checklisten');
      for (const cl of checklists) {
        const done = (cl.items || []).filter(i => i.completed).length;
        const total = (cl.items || []).length;
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#111111')
           .text(`${cl.title}  (${done}/${total})`, leftMargin);
        doc.moveDown(0.2);
        for (const item of cl.items) {
          const mark = item.completed ? '[x]' : '[ ]';
          doc.fontSize(10).font('Helvetica')
             .fillColor(item.completed ? '#888888' : '#1a1a1a')
             .text(`  ${mark}  ${item.text}`, leftMargin, doc.y, { width: contentWidth });
        }
        doc.fillColor('#000000');
        doc.moveDown(0.4);
      }
    }

    // ── Comments ─────────────────────────────────────────────────────────────
    if (comments.length > 0) {
      sectionHeading('Kommentare');
      for (const c of comments) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#555555')
           .text(`${c.username || 'Unbekannt'}  -  ${formatDate(c.created_at)}`, leftMargin);
        doc.fillColor('#1a1a1a').fontSize(10).font('Helvetica').text(c.content, leftMargin, doc.y, { width: contentWidth });
        doc.moveDown(0.5);
      }
    }

    // ── History ───────────────────────────────────────────────────────────────
    if (history.length > 0) {
      sectionHeading('Verlauf');
      const typeMap = {
        created: 'Erstellt', moved: 'Verschoben',
        field_updated: 'Felder aktualisiert', comment: 'Kommentar',
        file_uploaded: 'Datei hochgeladen', checklist_checked: 'Checkliste abgehakt',
        label_changed: 'Label geaendert', archived: 'Archiviert',
        restored: 'Wiederhergestellt', escalation_sent: 'Erinnerung gesendet',
      };
      for (const h of history) {
        let actionLabel = typeMap[h.action_type] || h.action_type;
        if (h.action_type === 'moved' && h.details) {
          try {
            const d = JSON.parse(h.details);
            const from = d.from_column_name || `Spalte ${d.from_column_id}`;
            const to   = d.to_column_name   || `Spalte ${d.to_column_id}`;
            if (d.from_column_id) actionLabel += ` (${from} → ${to})`;
          } catch {}
        }
        const rowY = doc.y;
        doc.fontSize(9).font('Helvetica').fillColor('#888888')
           .text(formatDate(h.created_at), leftMargin, rowY, { width: 90, continued: false });
        doc.fillColor('#444444').text(h.username || '—', leftMargin + 95, rowY, { width: 90, continued: false });
        doc.fillColor('#1a1a1a').font('Helvetica-Bold').text(actionLabel, leftMargin + 190, rowY, { width: contentWidth - 190 });
        doc.fillColor('#000000');
        doc.moveDown(0.1);
      }
    }

    // Footer with page number
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(8).font('Helvetica').fillColor('#999999')
         .text(
           `${appName}  -  Seite ${i + 1} von ${range.count}`,
           leftMargin,
           doc.page.height - 30,
           { width: contentWidth, align: 'right', lineBreak: false }
         );
      doc.page.margins.bottom = savedBottom;
    }

    doc.flushPages();
    doc.end();
  });

  // Merge: pdfkit output + attached PDFs/images
  const mergedPdf = await LibPDFDocument.create();

  const coverDoc = await LibPDFDocument.load(pdfkitBuffer);
  const coverPages = await mergedPdf.copyPages(coverDoc, coverDoc.getPageIndices());
  for (const page of coverPages) mergedPdf.addPage(page);

  for (const file of files) {
    const filePath = path.join(uploadPath, 'attachments', file.filename);
    if (!fs.existsSync(filePath)) continue;

    if (file.mime_type === 'application/pdf') {
      try {
        const pdfBytes = fs.readFileSync(filePath);
        const attachedDoc = await LibPDFDocument.load(pdfBytes);
        const pages = await mergedPdf.copyPages(attachedDoc, attachedDoc.getPageIndices());
        for (const page of pages) mergedPdf.addPage(page);
      } catch (e) {
        console.error('PDF merge error for file:', file.original_name, e.message);
      }
    } else if (file.mime_type && file.mime_type.startsWith('image/')) {
      try {
        const imageBytes = fs.readFileSync(filePath);
        let embeddedImage;
        if (file.mime_type === 'image/jpeg' || file.mime_type === 'image/jpg') {
          embeddedImage = await mergedPdf.embedJpg(imageBytes);
        } else if (file.mime_type === 'image/png') {
          embeddedImage = await mergedPdf.embedPng(imageBytes);
        } else {
          continue;
        }

        // Scale image to fit A4 page (595 x 842 pts)
        const maxW = 595 - 100;
        const maxH = 842 - 100;
        const ratio = Math.min(maxW / embeddedImage.width, maxH / embeddedImage.height, 1);
        const imgW = embeddedImage.width * ratio;
        const imgH = embeddedImage.height * ratio;

        const imgPage = mergedPdf.addPage([595, 842]);
        imgPage.drawImage(embeddedImage, {
          x: (595 - imgW) / 2,
          y: (842 - imgH) / 2,
          width: imgW,
          height: imgH,
        });
      } catch (e) {
        console.error('Image embed error for file:', file.original_name, e.message);
      }
    }
  }

  const finalBytes = await mergedPdf.save();
  return Buffer.from(finalBytes);
}

module.exports = { generateSummaryPDF };
