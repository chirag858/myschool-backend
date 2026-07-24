import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';

import type { ReportData } from './reports.service';

export async function sendExcel(res: Response, report: ReportData, fileName: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  sheet.addRow(report.columns);
  sheet.getRow(1).font = { bold: true };
  for (const row of report.rows) sheet.addRow(row);
  sheet.columns.forEach((col) => {
    col.width = Math.max(14, ...(col.values ?? []).map((v) => String(v ?? '').length + 2));
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

export function sendPdf(res: Response, report: ReportData, fileName: string): void {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).text(report.title, { underline: true });
  doc.fontSize(10).fillColor('#555').text(report.subtitle);
  doc.moveDown(1);

  const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / report.columns.length;
  const startX = doc.page.margins.left;
  let y = doc.y;

  doc.fontSize(10).fillColor('#000');
  report.columns.forEach((c, i) => doc.text(c, startX + i * colWidth, y, { width: colWidth, continued: false }));
  y += 18;
  doc.moveTo(startX, y - 4).lineTo(doc.page.width - doc.page.margins.right, y - 4).stroke();

  for (const row of report.rows) {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    row.forEach((cell, i) => doc.text(String(cell), startX + i * colWidth, y, { width: colWidth }));
    y += 16;
  }

  doc.end();
}
