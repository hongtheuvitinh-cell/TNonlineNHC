import { 
    Document, 
    Packer, 
    Paragraph, 
    TextRun, 
    Table, 
    TableRow, 
    TableCell, 
    WidthType, 
    AlignmentType, 
    BorderStyle, 
    ImageRun,
    Math as DocxMath,
    MathRun,
    MathFraction,
    MathSubScript,
    MathSuperScript,
    MathSubSuperScript,
    MathRadical,
    MathLimitUpper,
    MathLimitLower,
    MathSum,
    MathIntegral,
    MathRoundBrackets,
    MathSquareBrackets,
    MathCurlyBrackets
} from 'docx';
import { mml2omml } from '@hungknguyen/mathml2omml';
import { mathJaxReady } from '@hungknguyen/docx-math-converter';
import { Quiz, Question } from '../types';
import { normalizeFullText } from './vietnameseFixer';

// Chuẩn hóa và làm sạch mã LaTeX trước khi chuyển sang MathML/OMML
function cleanLatexForDocx(latex: string): string {
    if (!latex) return '';
    return latex
        .replace(/\\dfrac/g, '\\frac')
        .replace(/\\tfrac/g, '\\frac')
        .replace(/\\displaystyle/g, '')
        .replace(/\\textstyle/g, '')
        .replace(/\\scriptstyle/g, '')
        .replace(/\\scriptscriptstyle/g, '')
        .replace(/\\quad/g, ' ')
        .replace(/\\qquad/g, ' ')
        .replace(/\\enspace/g, ' ')
        .replace(/\\[,;:!]/g, ' ')
        .trim();
}

// Chuyển đổi danh sách phần tử con trong cây OMML XML
function convertOmmlChildren(children: HTMLCollection | Element[] | NodeListOf<Element>): any[] {
    const result: any[] = [];
    for (let i = 0; i < children.length; i++) {
        const child = children[i] as Element;
        const converted = convertOmmlItem(child);
        if (converted) {
            if (Array.isArray(converted)) {
                result.push(...converted);
            } else {
                result.push(converted);
            }
        }
    }
    return result;
}

// Chuyển đổi từng thẻ OMML (Office Math ML) sang thành phần docx Math tương ứng
// Bỏ qua các thẻ thuộc tính để tuyệt đối KHÔNG sinh ký tự rác hoặc ô vuông "口"
function convertOmmlItem(item: Element): any {
    if (!item || !item.tagName) return null;
    const tagName = item.tagName.toLowerCase();

    // Các thẻ cấu hình / thuộc tính Office Math - BỎ QUA AN TOÀN (Không bao giờ tạo MathRun("口"))
    if (
        tagName.endsWith('pr') ||
        tagName === 'm:deghide' ||
        tagName === 'm:type' ||
        tagName === 'm:scrlvl' ||
        tagName === 'm:ctrlpr' ||
        tagName === 'm:lit' ||
        tagName === 'm:nor' ||
        tagName === 'm:pos' ||
        tagName === 'm:aln' ||
        tagName === 'm:val' ||
        tagName === 'w:rpr'
    ) {
        return null;
    }

    // 1. Phân số (Fraction: m:f)
    if (tagName === 'm:f') {
        const num = item.getElementsByTagName('m:num')[0];
        const den = item.getElementsByTagName('m:den')[0];
        return new MathFraction({
            numerator: num ? convertOmmlChildren(num.children) : [],
            denominator: den ? convertOmmlChildren(den.children) : []
        });
    }

    // 2. Chuỗi ký tự (Run: m:r)
    if (tagName === 'm:r') {
        const t = item.getElementsByTagName('m:t')[0];
        const text = t ? (t.textContent || '') : '';
        return new MathRun(text);
    }

    // 3. Chỉ số dưới (Subscript: m:ssub)
    if (tagName === 'm:ssub') {
        const e = item.getElementsByTagName('m:e')[0];
        const sub = item.getElementsByTagName('m:sub')[0];
        return new MathSubScript({
            children: e ? convertOmmlChildren(e.children) : [],
            subScript: sub ? convertOmmlChildren(sub.children) : []
        });
    }

    // 4. Chỉ số trên (Superscript: m:ssup)
    if (tagName === 'm:ssup') {
        const e = item.getElementsByTagName('m:e')[0];
        const sup = item.getElementsByTagName('m:sup')[0];
        return new MathSuperScript({
            children: e ? convertOmmlChildren(e.children) : [],
            superScript: sup ? convertOmmlChildren(sup.children) : []
        });
    }

    // 5. Cả chỉ số trên và dưới (Sub-Superscript: m:ssubsup)
    if (tagName === 'm:ssubsup') {
        const e = item.getElementsByTagName('m:e')[0];
        const sub = item.getElementsByTagName('m:sub')[0];
        const sup = item.getElementsByTagName('m:sup')[0];
        return new MathSubSuperScript({
            children: e ? convertOmmlChildren(e.children) : [],
            superScript: sup ? convertOmmlChildren(sup.children) : [],
            subScript: sub ? convertOmmlChildren(sub.children) : []
        });
    }

    // 6. Căn thức (Radical / Căn bậc 2 / Căn bậc n: m:rad)
    if (tagName === 'm:rad') {
        const e = item.getElementsByTagName('m:e')[0];
        const deg = item.getElementsByTagName('m:deg')[0];
        let degree: any[] | undefined = undefined;
        if (deg && deg.children && deg.children.length > 0) {
            const degItems = convertOmmlChildren(deg.children);
            if (degItems.length > 0) degree = degItems;
        }
        return new MathRadical({
            children: e ? convertOmmlChildren(e.children) : [],
            degree: degree
        });
    }

    // 7. Dấu ngoặc (Delimiter: m:d)
    if (tagName === 'm:d') {
        const e = item.getElementsByTagName('m:e')[0];
        const begChr = item.getElementsByTagName('m:begChr')[0]?.getAttribute('m:val') || '(';
        const endChr = item.getElementsByTagName('m:endChr')[0]?.getAttribute('m:val') || ')';
        const inner = e ? convertOmmlChildren(e.children) : [];
        if (begChr === '[' && endChr === ']') {
            return new MathSquareBrackets({ children: inner });
        } else if (begChr === '{' && endChr === '}') {
            return new MathCurlyBrackets({ children: inner });
        } else {
            return new MathRoundBrackets({ children: inner });
        }
    }

    // 8. Giới hạn trên / dưới (Limits: m:limupp, m:limlow)
    if (tagName === 'm:limupp') {
        const e = item.getElementsByTagName('m:e')[0];
        const lim = item.getElementsByTagName('m:lim')[0];
        return new MathLimitUpper({
            children: e ? convertOmmlChildren(e.children) : [],
            limit: lim ? convertOmmlChildren(lim.children) : []
        });
    }
    if (tagName === 'm:limlow') {
        const e = item.getElementsByTagName('m:e')[0];
        const lim = item.getElementsByTagName('m:lim')[0];
        return new MathLimitLower({
            children: e ? convertOmmlChildren(e.children) : [],
            limit: lim ? convertOmmlChildren(lim.children) : []
        });
    }

    // 9. Phép toán tích phân / tổng (N-Ary: m:nary)
    if (tagName === 'm:nary') {
        const char = item.getElementsByTagName('m:chr')[0];
        const charVal = char?.getAttribute('m:val');
        const e = item.getElementsByTagName('m:e')[0];
        const sub = item.getElementsByTagName('m:sub')[0];
        const sup = item.getElementsByTagName('m:sup')[0];
        const inner = e ? convertOmmlChildren(e.children) : [];
        const subChildren = sub ? convertOmmlChildren(sub.children) : [];
        const supChildren = sup ? convertOmmlChildren(sup.children) : [];
        if (charVal === '∫') {
            return new MathIntegral({
                children: inner,
                superScript: supChildren,
                subScript: subChildren
            });
        }
        return new MathSum({
            children: inner,
            superScript: supChildren,
            subScript: subChildren
        });
    }

    // 10. Các phần tử chứa phần tử con (m:e, m:box, m:acc, m:bar, m:groupChr, v.v.): duyệt tiếp qua các con
    if (item.children && item.children.length > 0) {
        return convertOmmlChildren(item.children);
    }

    // Nếu là lá có nội dung text
    if (item.textContent && item.textContent.trim()) {
        return new MathRun(item.textContent);
    }

    return null;
}

// Chuyển đổi chuỗi XML OMML sang đối tượng DocxMath
function convertOmmlToDocxMath(ommlString: string): DocxMath | null {
    if (!ommlString) return null;
    try {
        if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(ommlString, 'text/xml');
            const mathElement = xmlDoc.getElementsByTagName('m:oMath')[0] || xmlDoc.documentElement;
            if (!mathElement) return null;
            const children = convertOmmlChildren(mathElement.children);
            if (children.length === 0) return null;
            return new DocxMath({ children });
        }
    } catch (err) {
        console.warn('Lỗi phân tích cú pháp OMML XML:', err);
    }
    return null;
}

// Chuyển đổi LaTeX sang DocxMath mà không bị lỗi ký tự ô vuông
function convertLatexToDocxMath(latex: string): DocxMath | null {
    const clean = cleanLatexForDocx(latex);
    if (!clean) return null;

    let mathml: string | null = null;

    // 1. Ưu tiên MathJax nếu đã sẵn sàng
    if (typeof window !== 'undefined' && (window as any).MathJax?.tex2mml) {
        try {
            const mml = (window as any).MathJax.tex2mml(clean);
            if (mml && !mml.includes('merror')) {
                mathml = mml;
            }
        } catch (e) {
            // bỏ qua
        }
    }

    // 2. Dự phòng bằng KaTeX nếu MathJax chưa sẵn sàng
    if (!mathml && typeof window !== 'undefined' && (window as any).katex?.renderToString) {
        try {
            const rendered = (window as any).katex.renderToString(clean, {
                output: 'mathml',
                throwOnError: false,
                displayMode: false
            });
            const match = rendered.match(/<math[\s\S]*?<\/math>/);
            if (match) {
                mathml = match[0];
            }
        } catch (e) {
            // bỏ qua
        }
    }

    if (!mathml) return null;

    try {
        const omml = mml2omml(mathml, { disableDecode: true });
        if (!omml) return null;
        return convertOmmlToDocxMath(omml);
    } catch (e) {
        console.warn('Lỗi chuyển đổi OMML sang Docx Math:', e);
        return null;
    }
}

// Chuyển đổi chuỗi base64 hoặc URL ảnh thành Uint8Array cho ImageRun
async function getImageData(src: string): Promise<{ data: Uint8Array; type: 'png' | 'jpg'; width: number; height: number } | null> {
    try {
        let uint8: Uint8Array;
        let imageType: 'png' | 'jpg' = 'png';
        if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg') || src.toLowerCase().endsWith('.jpg') || src.toLowerCase().endsWith('.jpeg')) {
            imageType = 'jpg';
        }

        if (src.startsWith('data:')) {
            const base64Data = src.split(',')[1];
            const binaryString = atob(base64Data);
            uint8 = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8[i] = binaryString.charCodeAt(i);
            }
        } else {
            const resp = await fetch(src);
            const arrayBuffer = await resp.arrayBuffer();
            uint8 = new Uint8Array(arrayBuffer);
        }

        // Lấy kích thước ảnh tự nhiên nếu chạy trong browser
        let width = 350;
        let height = 200;
        if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
            await new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const aspect = img.naturalWidth / (img.naturalHeight || 1);
                    width = Math.min(420, img.naturalWidth);
                    height = Math.round(width / (aspect || 1));
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = src;
            });
        }
        return { data: uint8, type: imageType, width, height };
    } catch (e) {
        console.warn("Không thể tải ảnh cho file DOCX:", e);
        return null;
    }
}

// Xử lý chuỗi văn bản chứa LaTeX ($...$) thành mảng TextRun / Math (Equation) của Word
function parseMixedTextToDocxRuns(
    rawText: string, 
    baseOptions: { bold?: boolean; italics?: boolean; size?: number; font?: string; underline?: boolean } = {}
): (TextRun | any)[] {
    if (!rawText) return [new TextRun({ text: '', font: baseOptions.font || 'Times New Roman' })];

    const clean = normalizeFullText(rawText);
    const parts = clean.split(/(\$.*?\$)/g);
    const runs: (TextRun | any)[] = [];

    const fontName = baseOptions.font || 'Times New Roman';
    const fontSize = baseOptions.size || 24; // 24 = 12pt

    for (const part of parts) {
        if (!part) continue;

        if (part.startsWith('$') && part.endsWith('$')) {
            const latex = part.slice(1, -1).trim();
            if (!latex) continue;
            try {
                // Chuyển LaTeX sang đối tượng Office Math (Word Equation) chất lượng cao
                const mathElement = convertLatexToDocxMath(latex);
                if (mathElement) {
                    runs.push(mathElement);
                } else {
                    runs.push(new TextRun({
                        text: `$${latex}$`,
                        font: fontName,
                        size: fontSize,
                        italics: true
                    }));
                }
            } catch (err) {
                // Fallback nếu công thức quá phức tạp hoặc lỗi cú pháp
                runs.push(new TextRun({
                    text: `$${latex}$`,
                    font: fontName,
                    size: fontSize,
                    italics: true
                }));
            }
        } else {
            // Xử lý các thẻ HTML đơn giản nếu có (<br/>, <b>, <i>, <u>)
            const subTokens = part.split(/(<br\s*\/?>|<\/?b>|<\/?i>|<\/?u>)/gi);
            let isBold = baseOptions.bold || false;
            let isItalic = baseOptions.italics || false;
            let isUnderline = baseOptions.underline || false;

            for (const token of subTokens) {
                if (!token) continue;
                const lower = token.toLowerCase();
                if (lower === '<br>' || lower === '<br/>' || lower === '<br />') {
                    runs.push(new TextRun({ text: '\n', break: 1, font: fontName, size: fontSize }));
                } else if (lower === '<b>') {
                    isBold = true;
                } else if (lower === '</b>') {
                    isBold = baseOptions.bold || false;
                } else if (lower === '<i>') {
                    isItalic = true;
                } else if (lower === '</i>') {
                    isItalic = baseOptions.italics || false;
                } else if (lower === '<u>') {
                    isUnderline = true;
                } else if (lower === '</u>') {
                    isUnderline = baseOptions.underline || false;
                } else {
                    // Văn bản thường - loại bỏ các thẻ HTML còn sót
                    const textContent = token.replace(/<[^>]+>/g, '');
                    if (textContent) {
                        runs.push(new TextRun({
                            text: textContent,
                            font: fontName,
                            size: fontSize,
                            bold: isBold,
                            italics: isItalic,
                            underline: isUnderline ? {} : undefined
                        }));
                    }
                }
            }
        }
    }

    return runs;
}

export interface ExportDocxOptions {
    isAdmin?: boolean;
    layoutMode?: 'single' | 'auto';
}

export async function exportQuizToDocx(quiz: Quiz, options: ExportDocxOptions = {}): Promise<void> {
    const { isAdmin = true, layoutMode = 'single' } = options;

    // Khởi tạo MathJax engine của bộ chuyển đổi
    try {
        await mathJaxReady();
    } catch (e) {
        console.warn("MathJax initialization warning:", e);
    }

    const docChildren: (Paragraph | Table)[] = [];

    // 1. Header văn bản (Sở GDĐT / Trường - Đề thi chính thức)
    const headerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        },
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        width: { size: 50, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 40 },
                                children: [
                                    new TextRun({ text: 'SỞ GDĐT TP. HỒ CHÍ MINH', bold: true, font: 'Times New Roman', size: 22 })
                                ]
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 60 },
                                children: [
                                    new TextRun({ text: 'TRƯỜNG THPT NGUYỄN HỮU CẦU', bold: true, font: 'Times New Roman', size: 22 })
                                ]
                            })
                        ]
                    }),
                    new TableCell({
                        width: { size: 50, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 40 },
                                children: [
                                    new TextRun({ text: 'ĐỀ THI CHÍNH THỨC', bold: true, font: 'Times New Roman', size: 23 })
                                ]
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 60 },
                                children: [
                                    new TextRun({ text: `Môn: ${quiz.category || 'Vật lý'} - Khối ${quiz.grade}`, bold: true, font: 'Times New Roman', size: 22 })
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    });
    docChildren.push(headerTable);

    // Khung điền thông tin Họ tên, SBD
    const infoBoxTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
            left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
            right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        },
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        margins: { top: 80, bottom: 80, left: 140, right: 140 },
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({ text: 'Họ và tên: .......................................................................... SBD: .....................................', bold: true, font: 'Times New Roman', size: 21 })
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    });
    docChildren.push(infoBoxTable);

    // Tiêu đề đề thi
    docChildren.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 180 },
            children: [
                new TextRun({ text: normalizeFullText(quiz.title).toUpperCase(), bold: true, font: 'Times New Roman', size: 28 })
            ]
        })
    );

    // 2. Nội dung các phần thi
    const mcqQuestions = quiz.questions.filter(q => q.type === 'mcq');
    const groupTfQuestions = quiz.questions.filter(q => q.type === 'group-tf');
    const shortQuestions = quiz.questions.filter(q => q.type === 'short');

    // PHẦN I
    if (mcqQuestions.length > 0) {
        docChildren.push(
            new Paragraph({
                spacing: { before: 200, after: 120 },
                border: { bottom: { color: '000000', size: 12, style: BorderStyle.SINGLE, space: 4 } },
                children: [
                    new TextRun({ text: 'PHẦN I. CÂU HỎI TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN', bold: true, font: 'Times New Roman', size: 23 })
                ]
            })
        );

        for (let idx = 0; idx < mcqQuestions.length; idx++) {
            const q = mcqQuestions[idx];
            await addQuestionToDoc(docChildren, q, idx + 1, layoutMode);
        }
    }

    // PHẦN II
    if (groupTfQuestions.length > 0) {
        docChildren.push(
            new Paragraph({
                spacing: { before: 280, after: 120 },
                border: { bottom: { color: '000000', size: 12, style: BorderStyle.SINGLE, space: 4 } },
                children: [
                    new TextRun({ text: 'PHẦN II. CÂU HỎI TRẮC NGHIỆM ĐÚNG SAI', bold: true, font: 'Times New Roman', size: 23 })
                ]
            })
        );

        for (let idx = 0; idx < groupTfQuestions.length; idx++) {
            const q = groupTfQuestions[idx];
            await addGroupTfQuestionToDoc(docChildren, q, idx + 1);
        }
    }

    // PHẦN III
    if (shortQuestions.length > 0) {
        docChildren.push(
            new Paragraph({
                spacing: { before: 280, after: 120 },
                border: { bottom: { color: '000000', size: 12, style: BorderStyle.SINGLE, space: 4 } },
                children: [
                    new TextRun({ text: 'PHẦN III. CÂU HỎI TRẮC NGHIỆM TRẢ LỜI NGẮN', bold: true, font: 'Times New Roman', size: 23 })
                ]
            })
        );

        for (let idx = 0; idx < shortQuestions.length; idx++) {
            const q = shortQuestions[idx];
            await addShortQuestionToDoc(docChildren, q, idx + 1);
        }
    }

    // 3. Bảng đáp án (Nếu là giáo viên / admin)
    if (isAdmin) {
        addAnswerKeysToDoc(docChildren, mcqQuestions, groupTfQuestions, shortQuestions);
    }

    // Footer kết thúc
    docChildren.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 360, after: 120 },
            children: [
                new TextRun({ text: '--- HẾT ---', bold: true, font: 'Times New Roman', size: 22 })
            ]
        })
    );

    // Tạo Document hoàn chỉnh
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: 1000,    // ~1.76 cm
                        bottom: 1000,
                        left: 1200,   // ~2.11 cm
                        right: 1000
                    }
                }
            },
            children: docChildren
        }]
    });

    // Xuất file sang Blob và kích hoạt tải về
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeTitle = quiz.title.replace(/[/\\?%*:|"<>]/g, '_');
    link.download = `${safeTitle}.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Thêm câu hỏi Trắc nghiệm nhiều lựa chọn vào DOCX
async function addQuestionToDoc(
    docChildren: (Paragraph | Table)[], 
    q: Question, 
    qNum: number, 
    layoutMode: 'single' | 'auto'
) {
    const runs = [
        new TextRun({ text: `Câu ${qNum}: `, bold: true, italics: true, underline: {}, font: 'Times New Roman', size: 24 }),
        ...parseMixedTextToDocxRuns(q.text, { size: 24 })
    ];

    docChildren.push(
        new Paragraph({
            spacing: { before: 120, after: 60, line: 280 },
            children: runs
        })
    );

    // Nếu có hình ảnh đính kèm
    if (q.imageUrl) {
        const imgInfo = await getImageData(q.imageUrl);
        if (imgInfo) {
            docChildren.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 80 },
                    children: [
                        new ImageRun({
                            data: imgInfo.data,
                            type: imgInfo.type,
                            transformation: {
                                width: imgInfo.width,
                                height: imgInfo.height
                            }
                        })
                    ]
                })
            );
        }
    }

    const options = q.options || [];
    if (options.length === 0) return;

    const maxLen = Math.max(...options.map(o => (o || '').length));
    const totalLen = options.reduce((sum, o) => sum + (o || '').length, 0);

    // Chế độ 1 dòng 4 cột (nếu ngắn và layoutMode = auto)
    if (layoutMode === 'auto' && options.length === 4 && maxLen <= 20 && totalLen <= 75) {
        const optionCells = options.map((opt, i) => {
            const optLabel = String.fromCharCode(65 + i) + '. ';
            return new TableCell({
                width: { size: 25, type: WidthType.PERCENTAGE },
                children: [
                    new Paragraph({
                        spacing: { before: 30, after: 30 },
                        children: [
                            new TextRun({ text: optLabel, bold: true, font: 'Times New Roman', size: 24 }),
                            ...parseMixedTextToDocxRuns(opt, { size: 24 })
                        ]
                    })
                ]
            });
        });

        docChildren.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
                },
                rows: [new TableRow({ children: optionCells })]
            })
        );
        return;
    }

    // Chế độ 2 dòng 2 cột (nếu layoutMode = auto và maxLen <= 45)
    if (layoutMode === 'auto' && options.length === 4 && maxLen <= 45) {
        const row1 = new TableRow({
            children: [
                new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                        new Paragraph({
                            spacing: { before: 30, after: 30 },
                            children: [
                                new TextRun({ text: 'A. ', bold: true, font: 'Times New Roman', size: 24 }),
                                ...parseMixedTextToDocxRuns(options[0], { size: 24 })
                            ]
                        })
                    ]
                }),
                new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                        new Paragraph({
                            spacing: { before: 30, after: 30 },
                            children: [
                                new TextRun({ text: 'B. ', bold: true, font: 'Times New Roman', size: 24 }),
                                ...parseMixedTextToDocxRuns(options[1], { size: 24 })
                            ]
                        })
                    ]
                })
            ]
        });

        const row2 = new TableRow({
            children: [
                new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                        new Paragraph({
                            spacing: { before: 30, after: 30 },
                            children: [
                                new TextRun({ text: 'C. ', bold: true, font: 'Times New Roman', size: 24 }),
                                ...parseMixedTextToDocxRuns(options[2], { size: 24 })
                            ]
                        })
                    ]
                }),
                new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                        new Paragraph({
                            spacing: { before: 30, after: 30 },
                            children: [
                                new TextRun({ text: 'D. ', bold: true, font: 'Times New Roman', size: 24 }),
                                ...parseMixedTextToDocxRuns(options[3], { size: 24 })
                            ]
                        })
                    ]
                })
            ]
        });

        docChildren.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
                },
                rows: [row1, row2]
            })
        );
        return;
    }

    // Mặc định: Mỗi phương án 1 dòng riêng thụt lề chuẩn
    for (let i = 0; i < options.length; i++) {
        const optLabel = String.fromCharCode(65 + i) + '. ';
        docChildren.push(
            new Paragraph({
                indent: { left: 360 }, // Thụt lề ~ 0.63cm
                spacing: { before: 30, after: 30, line: 260 },
                children: [
                    new TextRun({ text: optLabel, bold: true, font: 'Times New Roman', size: 24 }),
                    ...parseMixedTextToDocxRuns(options[i], { size: 24 })
                ]
            })
        );
    }
}

// Thêm câu hỏi Đúng/Sai
async function addGroupTfQuestionToDoc(docChildren: (Paragraph | Table)[], q: Question, qNum: number) {
    const runs = [
        new TextRun({ text: `Câu ${qNum}: `, bold: true, italics: true, underline: {}, font: 'Times New Roman', size: 24 }),
        ...parseMixedTextToDocxRuns(q.text, { size: 24 })
    ];

    docChildren.push(
        new Paragraph({
            spacing: { before: 120, after: 60, line: 280 },
            children: runs
        })
    );

    if (q.imageUrl) {
        const imgInfo = await getImageData(q.imageUrl);
        if (imgInfo) {
            docChildren.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 80 },
                    children: [
                        new ImageRun({
                            data: imgInfo.data,
                            type: imgInfo.type,
                            transformation: {
                                width: imgInfo.width,
                                height: imgInfo.height
                            }
                        })
                    ]
                })
            );
        }
    }

    const subQuestions = q.subQuestions || [];
    for (let i = 0; i < subQuestions.length; i++) {
        const sq = subQuestions[i];
        const subLabel = String.fromCharCode(97 + i) + ') ';
        docChildren.push(
            new Paragraph({
                indent: { left: 360 },
                spacing: { before: 30, after: 30, line: 260 },
                children: [
                    new TextRun({ text: subLabel, bold: true, font: 'Times New Roman', size: 24 }),
                    ...parseMixedTextToDocxRuns(sq.text, { size: 24 })
                ]
            })
        );
    }
}

// Thêm câu hỏi Trả lời ngắn
async function addShortQuestionToDoc(docChildren: (Paragraph | Table)[], q: Question, qNum: number) {
    const runs = [
        new TextRun({ text: `Câu ${qNum}: `, bold: true, italics: true, underline: {}, font: 'Times New Roman', size: 24 }),
        ...parseMixedTextToDocxRuns(q.text, { size: 24 })
    ];

    docChildren.push(
        new Paragraph({
            spacing: { before: 120, after: 60, line: 280 },
            children: runs
        })
    );

    if (q.imageUrl) {
        const imgInfo = await getImageData(q.imageUrl);
        if (imgInfo) {
            docChildren.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 80 },
                    children: [
                        new ImageRun({
                            data: imgInfo.data,
                            type: imgInfo.type,
                            transformation: {
                                width: imgInfo.width,
                                height: imgInfo.height
                            }
                        })
                    ]
                })
            );
        }
    }

    docChildren.push(
        new Paragraph({
            indent: { left: 360 },
            spacing: { before: 40, after: 60 },
            children: [
                new TextRun({ 
                    text: 'Đáp số: ........................................................................', 
                    italics: true, 
                    color: '444444', 
                    font: 'Times New Roman', 
                    size: 22 
                })
            ]
        })
    );
}

// Thêm Bảng đáp án vào cuối file DOCX
function addAnswerKeysToDoc(
    docChildren: (Paragraph | Table)[],
    mcqQs: Question[],
    groupTfQs: Question[],
    shortQs: Question[]
) {
    // Ngắt trang trước bảng đáp án
    docChildren.push(
        new Paragraph({
            pageBreakBefore: true,
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 200 },
            children: [
                new TextRun({ text: 'BẢNG ĐÁP ÁN', bold: true, font: 'Times New Roman', size: 28 })
            ]
        })
    );

    const borderConfig = {
        top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        insideVertical: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    };

    // Bảng Phần I
    if (mcqQs.length > 0) {
        docChildren.push(
            new Paragraph({
                spacing: { before: 160, after: 80 },
                children: [
                    new TextRun({ text: 'PHẦN I. CÂU HỎI TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN', bold: true, font: 'Times New Roman', size: 22 })
                ]
            })
        );

        const rows: TableRow[] = [];
        const numRows = Math.ceil(mcqQs.length / 10);

        for (let r = 0; r < numRows; r++) {
            const chunk = mcqQs.slice(r * 10, (r + 1) * 10);
            
            // Hàng Tiêu đề: Câu 1, Câu 2...
            const headerCells: TableCell[] = [];
            for (let c = 0; c < 10; c++) {
                if (c < chunk.length) {
                    headerCells.push(new TableCell({
                        width: { size: 10, type: WidthType.PERCENTAGE },
                        shading: { fill: 'F1F5F9' },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [new TextRun({ text: `Câu ${r * 10 + c + 1}`, bold: true, font: 'Times New Roman', size: 20 })]
                            })
                        ]
                    }));
                } else {
                    headerCells.push(new TableCell({ width: { size: 10, type: WidthType.PERCENTAGE }, children: [new Paragraph({})] }));
                }
            }
            rows.push(new TableRow({ children: headerCells }));

            // Hàng Đáp án: A, B, C, D...
            const valueCells: TableCell[] = [];
            for (let c = 0; c < 10; c++) {
                if (c < chunk.length) {
                    const q = chunk[c];
                    const correctIdx = q.options?.indexOf(q.correctAnswer || '') ?? -1;
                    const label = correctIdx !== -1 ? String.fromCharCode(65 + correctIdx) : (q.correctAnswer || '?');
                    valueCells.push(new TableCell({
                        width: { size: 10, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [new TextRun({ text: label, bold: true, color: '166534', font: 'Times New Roman', size: 22 })]
                            })
                        ]
                    }));
                } else {
                    valueCells.push(new TableCell({ width: { size: 10, type: WidthType.PERCENTAGE }, children: [new Paragraph({})] }));
                }
            }
            rows.push(new TableRow({ children: valueCells }));
        }

        docChildren.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: borderConfig,
                rows
            })
        );
    }

    // Bảng Phần II
    if (groupTfQs.length > 0) {
        docChildren.push(
            new Paragraph({
                spacing: { before: 220, after: 80 },
                children: [
                    new TextRun({ text: 'PHẦN II. CÂU HỎI TRẮC NGHIỆM ĐÚNG SAI', bold: true, font: 'Times New Roman', size: 22 })
                ]
            })
        );

        const rows: TableRow[] = [
            new TableRow({
                children: [
                    new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: 'F1F5F9' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Câu', bold: true, font: 'Times New Roman', size: 20 })] })] }),
                    new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: 'F1F5F9' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'a', bold: true, font: 'Times New Roman', size: 20 })] })] }),
                    new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: 'F1F5F9' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'b', bold: true, font: 'Times New Roman', size: 20 })] })] }),
                    new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: 'F1F5F9' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'c', bold: true, font: 'Times New Roman', size: 20 })] })] }),
                    new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: 'F1F5F9' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'd', bold: true, font: 'Times New Roman', size: 20 })] })] }),
                ]
            })
        ];

        groupTfQs.forEach((q, i) => {
            const subAns = q.subQuestions || [];
            const cells = [
                new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Câu ${i + 1}`, bold: true, font: 'Times New Roman', size: 20 })] })] }),
            ];

            [0, 1, 2, 3].forEach(subIndex => {
                const sq = subAns[subIndex];
                const val = sq ? (String(sq.correctAnswer).toLowerCase() === 'true' || String(sq.correctAnswer).toLowerCase() === 'đúng' ? 'Đ' : 'S') : '-';
                cells.push(
                    new TableCell({
                        width: { size: 20, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [new TextRun({ text: val, bold: true, color: val === 'Đ' ? '166534' : 'DC2626', font: 'Times New Roman', size: 21 })]
                            })
                        ]
                    })
                );
            });

            rows.push(new TableRow({ children: cells }));
        });

        docChildren.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: borderConfig,
                rows
            })
        );
    }

    // Bảng Phần III
    if (shortQs.length > 0) {
        docChildren.push(
            new Paragraph({
                spacing: { before: 220, after: 80 },
                children: [
                    new TextRun({ text: 'PHẦN III. CÂU HỎI TRẮC NGHIỆM TRẢ LỜI NGẮN', bold: true, font: 'Times New Roman', size: 22 })
                ]
            })
        );

        const rows: TableRow[] = [
            new TableRow({
                children: [
                    new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, shading: { fill: 'F1F5F9' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Câu', bold: true, font: 'Times New Roman', size: 20 })] })] }),
                    new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, shading: { fill: 'F1F5F9' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Đáp án', bold: true, font: 'Times New Roman', size: 20 })] })] }),
                ]
            })
        ];

        shortQs.forEach((q, i) => {
            rows.push(
                new TableRow({
                    children: [
                        new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Câu ${i + 1}`, bold: true, font: 'Times New Roman', size: 20 })] })] }),
                        new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: q.correctAnswer || 'N/A', bold: true, color: '1D4ED8', font: 'Times New Roman', size: 21 })] })] }),
                    ]
                })
            );
        });

        docChildren.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: borderConfig,
                rows
            })
        );
    }
}
