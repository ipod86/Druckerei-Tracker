'use strict';

const PDFDocument = require('pdfkit');
const { PDFDocument: LibPDFDocument } = require('pdf-lib');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');

async function generateSummaryPDF(cardId) {
  const card = db.prepare(`
    SELECT ca.*, col.name as column_name, g.name as group_name,
           cu.name as customer_name, cu.company as customer_company,
           l.name as location_name,
           u.username as created_by_name
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    LEFT JOIN locations l ON ca.location_id = l.id
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

  const comments = db.prepare(`
    SELECT cc.*, u.username FROM card_comments cc
    LEFT JOIN users u ON cc.user_id = u.id
    WHERE cc.card_id = ? ORDER BY cc.created_at
  `).all(cardId);

  const transitionValues = db.prepare(`
    SELECT tv.value, tv.created_at, tf.field_name, tf.field_type,
           u.username,
           gf.name as from_group_name, gt.name as to_group_name
    FROM transition_values tv
    JOIN transition_fields tf ON tv.field_id = tf.id
    LEFT JOIN users u ON tv.user_id = u.id
    LEFT JOIN groups gf ON tf.from_group_id = gf.id
    LEFT JOIN groups gt ON tf.to_group_id = gt.id
    WHERE tv.card_id = ?
    ORDER BY tv.created_at
  `).all(cardId);

  const files = db.prepare('SELECT * FROM card_files WHERE card_id = ?').all(cardId);
  const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');

  // Create pdfkit document
  const pdfkitBuffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Helper: draw a section heading with underline
    function sectionHeading(title) {
      doc.moveDown(0.8);
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a1a1a').text(title);
      const y = doc.y + 1;
      doc.moveTo(doc.page.margins.left, y)
         .lineTo(doc.page.width - doc.page.margins.right, y)
         .strokeColor('#aaaaaa').lineWidth(0.8).stroke();
      doc.fillColor('#000000');
      doc.moveDown(0.4);
    }

    // Header
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const sObj = {};
    for (const s of settings) sObj[s.key] = s.value;
    const appName = sObj.app_name || 'Druckerei Tracker';

    // Top banner
    doc.rect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 54)
       .fillColor('#f5f5f5').fill();
    doc.fillColor('#333333').fontSize(11).font('Helvetica').text(appName, doc.page.margins.left + 10, doc.y - 46);
    doc.fillColor('#111111').fontSize(18).font('Helvetica-Bold').text('Karten-Zusammenfassung', doc.page.margins.left + 10, doc.y - 28);
    doc.fillColor('#000000');
    doc.moveDown(1.5);

    // Card title
    doc.fontSize(20).font('Helvetica-Bold').text(card.title);
    if (card.order_number) {
      doc.fontSize(11).font('Helvetica').fillColor('#555555').text(`Auftrag #${card.order_number}`);
      doc.fillColor('#000000');
    }
    doc.moveDown(0.6);

    // Meta table (2-col layout)
    const meta = [
      ['Status', `${card.group_name} / ${card.column_name}`],
      ['Kunde', [card.customer_name, card.customer_company].filter(Boolean).join(', ') || '—'],
      ['Standort', card.location_name || '—'],
      ['Fälligkeitsdatum', card.due_date || '—'],
      ['Erstellt von', `${card.created_by_name || '—'} am ${card.created_at}`],
    ];

    const labelW = 120;
    for (const [label, value] of meta) {
      const rowY = doc.y;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#666666').text(label, { width: labelW, continued: false });
      doc.fontSize(10).font('Helvetica').fillColor('#000000').text(value, doc.page.margins.left + labelW, rowY, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - labelW });
      doc.moveDown(0.1);
    }

    if (labels.length > 0) {
      const rowY = doc.y;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#666666').text('Labels', { width: labelW, continued: false });
      doc.fontSize(10).font('Helvetica').fillColor('#000000').text(labels.map(l => l.name).join(', '), doc.page.margins.left + labelW, rowY);
    }

    // Description
    if (card.description) {
      sectionHeading('Beschreibung');
      doc.fontSize(11).font('Helvetica').text(card.description, { align: 'justify' });
    }

    // Transition values — grouped by source group (the group the card left)
    if (transitionValues.length > 0) {
      sectionHeading('Übergabewerte');

      // Group by from_group_name
      const tvGroups = {};
      for (const tv of transitionValues) {
        const key = tv.from_group_name || '?';
        if (!tvGroups[key]) tvGroups[key] = [];
        tvGroups[key].push(tv);
      }

      for (const [groupName, entries] of Object.entries(tvGroups)) {
        doc.moveDown(0.5);
        // Group header
        doc.fontSize(11).font('Helvetica-Bold')
           .fillColor('#555555')
           .text(`Übergabe aus ${groupName}`, { underline: false });
        doc.fillColor('#000000');

        // Draw a thin separator line
        const lineY = doc.y + 2;
        doc.moveTo(doc.page.margins.left, lineY)
           .lineTo(doc.page.width - doc.page.margins.right, lineY)
           .strokeColor('#cccccc').lineWidth(0.5).stroke();
        doc.moveDown(0.3);

        for (const tv of entries) {
          // Field name in muted color
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text(tv.field_name.toUpperCase());
          doc.fillColor('#000000');
          // Value
          doc.fontSize(11).font('Helvetica').text(tv.value || '—');
          doc.moveDown(0.3);
        }
      }
    }

    // Checklists
    if (checklists.length > 0) {
      sectionHeading('Checklisten');
      for (const cl of checklists) {
        doc.fontSize(12).font('Helvetica-Bold').text(cl.title);
        doc.moveDown(0.2);
        for (const item of cl.items) {
          const check = item.completed ? '[x]' : '[ ]';
          doc.fontSize(11).font('Helvetica')
             .fillColor(item.completed ? '#888888' : '#000000')
             .text(`  ${check}  ${item.text}`);
        }
        doc.fillColor('#000000');
        doc.moveDown(0.4);
      }
    }

    // Comments
    if (comments.length > 0) {
      sectionHeading('Kommentare');
      for (const c of comments) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#444444')
           .text(`${c.username || 'Unbekannt'}  ·  ${c.created_at}`);
        doc.fillColor('#000000').fontSize(11).font('Helvetica').text(c.content);
        doc.moveDown(0.5);
      }
    }

    // History
    if (history.length > 0) {
      sectionHeading('Verlauf');
      const typeMap = {
        created: 'Erstellt',
        moved: 'Verschoben',
        field_updated: 'Felder aktualisiert',
        comment: 'Kommentar',
        file_uploaded: 'Datei hochgeladen',
        checklist_checked: 'Checkliste abgehakt',
        label_changed: 'Label geändert',
        archived: 'Archiviert',
        restored: 'Wiederhergestellt',
      };
      for (const h of history) {
        const actionLabel = typeMap[h.action_type] || h.action_type;
        doc.fontSize(9).font('Helvetica')
           .fillColor('#555555').text(h.created_at, { continued: true, width: 140 });
        doc.fillColor('#000000').text(`  ${h.username || '—'}`, { continued: true, width: 100 });
        doc.fillColor('#333333').font('Helvetica-Bold').text(`  ${actionLabel}`);
        doc.fillColor('#000000');
      }
    }

    doc.end();
  });

  // Now use pdf-lib to merge: pdfkit output + attached PDFs + image pages
  const mergedPdf = await LibPDFDocument.create();

  // Load pdfkit output
  const coverDoc = await LibPDFDocument.load(pdfkitBuffer);
  const coverPages = await mergedPdf.copyPages(coverDoc, coverDoc.getPageIndices());
  for (const page of coverPages) mergedPdf.addPage(page);

  // Append attached files
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
          continue; // gif/webp not supported by pdf-lib directly
        }

        const imgPage = mergedPdf.addPage([embeddedImage.width, embeddedImage.height]);
        imgPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: embeddedImage.width,
          height: embeddedImage.height,
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
