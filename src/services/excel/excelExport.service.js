/**
 * Excel Export Service
 * Reusable module for exporting data to Excel files
 */

const ExcelJS = require('exceljs');

// Shot type labels in Vietnamese
const SHOT_TYPE_LABELS = {
    'goc_trung': 'Góc trung',
    'can_canh': 'Cận cảnh',
    'goc_rong': 'Góc rộng',
    'overlay': 'Overlay'
};

/**
 * Export video script to Excel buffer
 * @param {Object} script - Video script document
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function exportVideoScriptToExcel(script) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AI Content Generator';
    workbook.created = new Date();
    
    const worksheet = workbook.addWorksheet('Kịch bản Video', {
        properties: { tabColor: { argb: 'FF9B59B6' } }
    });

    // Set column widths
    worksheet.columns = [
        { key: 'sceneNumber', width: 8 },
        { key: 'location', width: 20 },
        { key: 'shotType', width: 15 },
        { key: 'description', width: 40 },
        { key: 'voiceOver', width: 35 },
        { key: 'source', width: 15 },
        { key: 'note', width: 20 }
    ];

    // === HEADER SECTION ===
    // Title row
    worksheet.mergeCells('A1:G1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `KỊCH BẢN VIDEO: ${script.title}`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9B59B6' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    // Info rows
    const infoData = [
        ['Thời lượng:', script.duration || 'Không xác định'],
        ['Số cảnh:', `${script.scenes?.length || 0} cảnh`],
        ['Voice Over:', script.hasVoiceOver ? 'Có' : 'Không'],
        ['Ngày tạo:', new Date(script.createdAt).toLocaleDateString('vi-VN')]
    ];

    let rowIndex = 3;
    infoData.forEach(([label, value]) => {
        worksheet.getCell(`A${rowIndex}`).value = label;
        worksheet.getCell(`A${rowIndex}`).font = { bold: true };
        worksheet.mergeCells(`B${rowIndex}:G${rowIndex}`);
        worksheet.getCell(`B${rowIndex}`).value = value;
        rowIndex++;
    });

    // === SUMMARY SECTION ===
    rowIndex += 1;
    worksheet.mergeCells(`A${rowIndex}:G${rowIndex}`);
    const summaryLabel = worksheet.getCell(`A${rowIndex}`);
    summaryLabel.value = 'TÓM TẮT Ý TƯỞNG';
    summaryLabel.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    summaryLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3498DB' } };
    rowIndex++;

    worksheet.mergeCells(`A${rowIndex}:G${rowIndex}`);
    const summaryCell = worksheet.getCell(`A${rowIndex}`);
    summaryCell.value = script.summary || 'Không có tóm tắt';
    summaryCell.alignment = { wrapText: true };
    worksheet.getRow(rowIndex).height = 50;
    rowIndex += 2;

    // === SCENES TABLE ===
    // Table header
    const headerRow = worksheet.getRow(rowIndex);
    const headers = ['STT', 'Địa điểm', 'Góc quay', 'Mô tả hành động', 'Voice Over', 'Nguồn', 'Ghi chú'];
    headers.forEach((header, colIndex) => {
        const cell = headerRow.getCell(colIndex + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2ECC71' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });
    headerRow.height = 25;
    rowIndex++;

    // Table data
    if (script.scenes && script.scenes.length > 0) {
        script.scenes.forEach((scene, index) => {
            const dataRow = worksheet.getRow(rowIndex);
            const rowData = [
                scene.sceneNumber || (index + 1),
                scene.location || '',
                SHOT_TYPE_LABELS[scene.shotType] || scene.shotType || '',
                scene.description || '',
                scene.voiceOver || '',
                scene.source || '',
                scene.note || ''
            ];

            rowData.forEach((value, colIndex) => {
                const cell = dataRow.getCell(colIndex + 1);
                cell.value = value;
                cell.alignment = { wrapText: true, vertical: 'top' };
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });

            // Alternate row colors
            if (index % 2 === 1) {
                dataRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
                });
            }

            dataRow.height = 40;
            rowIndex++;
        });
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

/**
 * Create a simple data export to Excel
 * @param {Array} data - Array of objects to export
 * @param {Array} columns - Column definitions [{key, header, width}]
 * @param {string} sheetName - Worksheet name
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function exportDataToExcel(data, columns, sheetName = 'Data') {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = columns.map(col => ({
        key: col.key,
        header: col.header,
        width: col.width || 20
    }));

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // Add data
    data.forEach(item => {
        worksheet.addRow(item);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

module.exports = {
    exportVideoScriptToExcel,
    exportDataToExcel,
    SHOT_TYPE_LABELS
};
