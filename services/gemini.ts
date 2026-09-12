
    import { GoogleGenAI, Type } from "@google/genai";
    import { Question, Grade, QuestionLevel, SubQuestion } from "../types";
    import { v4 as uuidv4 } from 'uuid';
    import { normalizeFullText, cleanLatexTextTags, unpackAccidentallyMathWrappedParagraph } from './vietnameseFixer';

    export const cleanJsonString = (str: string): string => {
        return str.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    };

    export const safeParseJsonWithLatex = (inputStr: string): any => {
        if (!inputStr || typeof inputStr !== 'string') return null;
        let cleanStr = cleanJsonString(inputStr);

        // Danh sách các lệnh LaTeX phổ biến có chữ cái đầu trùng với ký tự escape JSON (\b, \t, \r, \n, \f)
        // Nếu không escape thành \\ thì JSON.parse sẽ ngầm biến \times thành Tab + "imes", \beta thành Backspace + "eta", \theta thành Tab + "heta"...
        const latexKeywords = 'times|theta|tau|tan|top|text|tilde|triangle|to|beta|bar|bm|mathbf|boldsymbol|begin|bullet|bot|rho|rightarrow|Rightarrow|right|rangle|rad|nu|nabla|neq|notin|not|frac|forall|flat|alpha|gamma|delta|epsilon|omega|pi|mu|lambda|sigma|phi|psi|sqrt|cdot|approx|pm|le|ge|sim|in|infty|vec|hat|circ|angle|partial';
        
        // 1. Tự động bảo vệ tất cả các lệnh LaTeX trước khi parse
        const preEscapedStr = cleanStr.replace(
            new RegExp(`(^|[^\\\\])\\\\(${latexKeywords})\\b`, 'g'),
            '$1\\\\$2'
        );

        // 2. Thử parse sau khi đã bảo vệ lệnh LaTeX
        try {
            return JSON.parse(preEscapedStr);
        } catch (firstErr) {
            // Nếu thất bại do các ký tự escape LaTeX khác (như \Delta, \s, \d...), sửa chữa tự động
            try {
                // Thay thế các ký tự escape không hợp lệ trong chuỗi JSON thành escape kép (\\)
                const fixedEscape = preEscapedStr.replace(/\\([^"\\\/bfnrtu]|u(?![\da-fA-F]{4}))/g, '\\\\$1');
                return JSON.parse(fixedEscape);
            } catch (secondErr) {
                // Thử dọn dẹp các ký tự điều khiển tab/newline ẩn
                try {
                    const noInvalidCtrl = preEscapedStr
                        .replace(/\r\n/g, "\\n")
                        .replace(/\n/g, "\\n")
                        .replace(/\t/g, "\\t");
                    return JSON.parse(noInvalidCtrl);
                } catch (thirdErr: any) {
                    // Cố gắng parse chuỗi gốc
                    try {
                        return JSON.parse(cleanStr);
                    } catch {
                        throw new Error("Cấu trúc JSON từ AI không hợp lệ: " + (firstErr as Error).message);
                    }
                }
            }
        }
    };

    const normalizeLevel = (val: any): QuestionLevel | undefined => {
        if (!val) return undefined;
        const str = String(val).trim().toUpperCase();
        if (str === 'B' || str === 'NB' || str.includes('NHẬN BIẾT') || str.includes('BIẾT') || str === 'EASY' || str.includes('KNOW')) return 'B';
        if (str === 'H' || str === 'TH' || str.includes('THÔNG HIỂU') || str.includes('HIỂU') || str === 'MEDIUM' || str.includes('UNDERSTAND')) return 'H';
        if (str === 'VD' || str.includes('VẬN DỤNG CAO') || str === 'VDC' || str === 'VERY HARD' || str === 'VHARD' || str.includes('ANALY') || str.includes('APPLY') || str === 'HARD') {
            if (str === 'VDC' || str.includes('CAO') || str === 'VERY HARD' || str === 'VHARD' || str.includes('ANALY')) return 'VDC';
            return 'VD';
        }
        return undefined;
    };

    const extractLevelFromText = (text: string): { cleanText: string; level?: QuestionLevel } => {
        if (!text) return { cleanText: "" };
        let cleanText = cleanLatexTextTags(text);
        let level: QuestionLevel | undefined = undefined;

        // Pattern: [B], (B), <B>, [NB], [H], [TH], [VD], [VDC] at start or inside
        const levelRegex = /(?:\[|\(|\<)\s*(B|NB|H|TH|VD|VDC|Nhận biết|Thông hiểu|Vận dụng cao|Vận dụng|Biết|Hiểu)\s*(?:\]|\)|\>)/i;
        const match = cleanText.match(levelRegex);
        if (match) {
            level = normalizeLevel(match[1]);
            cleanText = cleanText.replace(match[0], "").trim();
        }
        return { cleanText, level };
    };

    const stripOptionLabel = (text: string): string => {
        if (!text) return "";
        // Chuẩn hóa dấu tiếng Việt và làm sạch thẻ \text / ext
        let cleaned = normalizeFullText(text.trim());
        // Xử lý đệ quy để xóa nhiều lớp nhãn (VD: "A. A. Nội dung")
        const labelRegex = /^(\*?[A-Za-z0-9][\.\)\/\-:\s]\s*)/g;
        
        while (labelRegex.test(cleaned)) {
            cleaned = cleaned.replace(labelRegex, "").trim();
        }
        return cleanLatexTextTags(cleaned);
    };

    const EXTRACTION_INSTRUCTION = `Bạn là chuyên gia khảo thí và giáo viên sư phạm hàng đầu THPT quốc gia Việt Nam (Toán, Vật lí, Hóa học, Sinh học, Tin học, Ngữ văn, Lịch sử, Địa lí, GDCD, Tiếng Anh).

    NHIỆM VỤ:
    1. Trích xuất đầy đủ, trung thực và chính xác toàn bộ câu hỏi, phương án, mức độ nhận biết từ tài liệu được cung cấp (file PDF hoặc đoạn văn bản).
    2. TẠO LỜI GIẢI GỌN GÀNG, SÚC TÍCH 100% CHO TẤT CẢ CÁC CÂU HỎI (BẮT BUỘC): Điền đầy đủ vào trường 'solution'. TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỂ TRỐNG TRƯỜNG 'solution' Ở BẤT KỲ CÂU HỎI NÀO.

    QUY TẮC VIẾT LỜI GIẢI ('solution') - NGẮN GỌN, VIẾT CÔNG THỨC RỒI BẰNG KẾT QUẢ, THEO GẠCH ĐẦU DÒNG (CỰC KỲ QUAN TRỌNG):
    - PHONG CÁCH: Trình bày đơn giản, súc tích bằng các gạch đầu dòng (- ...).
    - CÔNG THỨC & KẾT QUẢ: Viết công thức/định luật rồi ghi dấu bằng ra kết quả luôn (Dạng: [Công thức] = [Kết quả]). 
    TUYỆT ĐỐI BỎ QUA quá trình điền/thay thế số chi tiết, vụn vặt vào giữa các phép tính để tránh làm rối lời giải.
    - KHÔNG viết văn rườm rà, giải thích lòng vòng lan man.

    1. MCQ (Trắc nghiệm 4 lựa chọn):
    - 'correctAnswer': BẮT BUỘC là nội dung chính xác của phương án đúng (không kèm nhãn A, B, C, D).
    - 'solution': Trình bày bằng gạch đầu dòng:
        - Áp dụng công thức: [Công thức] = [Kết quả].
        - Chọn đáp án: [Nội dung phương án đúng].

    2. GROUP-TF (Trắc nghiệm Đúng/Sai):
    - 'subQuestions': BẮT BUỘC có đủ 4 ý (a, b, c, d). Mỗi ý gồm 'text', 'correctAnswer' ("True" hoặc "False") và 'level' ("B"|"H"|"VD"|"VDC").
    - 'solution': BẮT BUỘC trình bày theo 4 ý a, b, c, d dạng gạch đầu dòng ngắn gọn:
        - a) Đúng. Vì [Công thức] = [Kết quả].
        - b) Sai. Vì [Công thức] = [Kết quả đúng].
        - c) Đúng. Vì [Lý do / Công thức ngắn gọn].
        - d) Sai. Vì [Lý do / Công thức ngắn gọn].

    3. SHORT (Trả lời ngắn):
    - 'type': BẮT BUỘC là "short".
    - 'correctAnswer': BẮT BUỘC là giá trị con số chính xác (VD: "12", "-3.5", "0.25").
    - 'solution': Dùng các gạch đầu dòng ngắn gọn:
        - [Công thức/Định luật] = [Kết quả].
        - Đáp số: [Số].

    4. PHÂN TÍCH ĐÁP ÁN:
    - Quét toàn bộ nội dung để tìm bảng đáp án (thường ở cuối trang hoặc đính kèm).
    - Nếu tài liệu không có bảng đáp án, AI tự tính để xác định 'correctAnswer'.

    5. NHẬN DIỆN MỨC ĐỘ (level: "B" | "H" | "VD" | "VDC"):
    - Tự động nhận diện: [B], [NB] -> "B" (Nhận biết); [H], [TH] -> "H" (Thông hiểu); [VD] -> "VD" (Vận dụng); [VDC] -> "VDC" (Vận dụng cao).

    6. QUY TẮC CÔNG THỨC & ĐƠN VỊ:
    - Mọi công thức toán học phải bọc trong cặp dấu $...$ (VD: $x^2 + y^2 = R^2$, $\\Delta t = 2$ s).
    - TUYỆT ĐỐI KHÔNG dùng thẻ \\text{...}, \\mathrm{...}, \\mbox{...} (để tránh lỗi JSON escape \\t thành 'ext').
    - Đơn vị đo (m/s, km/h, kg, g, N, J, W, V, A, Hz, s, min, h, cm, rad/s...): Viết dạng văn bản thường ngoài dấu $ (VD: '$v = 20$ m/s', '$m = 5$ kg') hoặc viết trực tiếp (VD: '$20$ m/s').
    - Chỉ số trên/dưới (VD: $v_{max}$, $F_{ms}$, $m_1$, $x_2$): Viết thẳng chữ vào chỉ số không bọc \\text{}.

    7. LÀM SẠCH NHÃN:
    - Xóa nhãn "A.", "B.", "a)", "b)", "[B]", "(H)"... ở đầu nội dung câu hỏi và các phương án nhưng giữ nguyên dấu $ của LaTeX.

    VÍ DỤ CẤU TRÚC JSON:
    - MCQ: {"type": "mcq", "level": "B", "text": "Một vật dao động điều hòa...", "options": ["$10$ cm/s", "$20$ cm/s", "$30$ cm/s", "$40$ cm/s"], "correctAnswer": "$20$ cm/s", "solution": "- Áp dụng công thức: $v_{max} = \\omega A = 20$ cm/s.\\n- Chọn đáp án: $20$ cm/s."}
    - GROUP-TF: {"type": "group-tf", "level": "H", "text": "Cho một vật dao động điều hòa có phương trình $x = 5\\cos(2\\pi t)$ cm...", "subQuestions": [{"text": "Biên độ dao động của vật là $5$ cm.", "correctAnswer": "True", "level": "B"}, {"text": "Tần số góc của dao động là $4\\pi$ rad/s.", "correctAnswer": "False", "level": "B"}, {"text": "Vận tốc cực đại của vật là $10\\pi$ cm/s.", "correctAnswer": "True", "level": "H"}, {"text": "Gia tốc cực đại của vật là $100\\pi^2$ cm/s$^2$.", "correctAnswer": "False", "level": "VD"}], "solution": "- a) Đúng. Biên độ $A = 5$ cm.\\n- b) Sai. Tần số góc $\\omega = 2\\pi$ rad/s.\\n- c) Đúng. Vận tốc cực đại $v_{max} = \\omega A = 10\\pi$ cm/s.\\n- d) Sai. Gia tốc cực đại $a_{max} = \\omega^2 A = 20\\pi^2$ cm/s$^2$."}
    - SHORT: {"type": "short", "level": "VD", "text": "Một mạch dao động LC lí tưởng gồm cuộn cảm thuần $L = 2$ mH và tụ điện $C = 8$ pF. Chu kỳ dao động riêng của mạch là bao nhiêu microgiây (làm tròn đến 2 chữ số thập phân)?", "correctAnswer": "0.79", "solution": "- Chu kỳ dao động: $T = 2\\pi\\sqrt{LC} = 2,51 \\cdot 10^{-6}$ s = $2,51$ $\\mu$s.\\n- Đáp số: $0.79$."}
    `;

    const processAIQuestions = (rawData: any[]): Question[] => {
        return rawData.map((item: any) => {
            const type = item.type?.toLowerCase() || 'mcq';
            const strippedOptions = item.options ? item.options.map((opt: string) => stripOptionLabel(opt)) : (type === 'mcq' ? [] : undefined);
            let finalCorrectAnswer = item.correctAnswer ? cleanLatexTextTags(String(item.correctAnswer)) : item.correctAnswer;

            // Xử lý trích xuất level từ text câu hỏi nếu chưa có
            let extractedMain = extractLevelFromText(item.text || "");
            let finalLevel = normalizeLevel(item.level) || extractedMain.level;
            let cleanedText = normalizeFullText(extractedMain.cleanText);
            let cleanedSolution = normalizeFullText(item.solution || "");

            if (type === 'mcq' && item.correctAnswer && item.options) {
                let ansText = item.correctAnswer.trim();
                const matchLabel = ansText.match(/(?:Đáp án|Chọn|Câu\s*\d+[:\s]*|^)\s*([A-D])(?:\.|\s|$)/i);
                
                if (matchLabel) {
                    const label = matchLabel[1].toUpperCase();
                    const index = label.charCodeAt(0) - 65;
                    if (item.options[index]) {
                        finalCorrectAnswer = stripOptionLabel(item.options[index]);
                    }
                } else {
                    finalCorrectAnswer = stripOptionLabel(ansText);
                }
            }

            // Đảm bảo correctAnswer của MCQ luôn khớp với một trong các options sau khi đã strip
            if (type === 'mcq' && strippedOptions && finalCorrectAnswer) {
                const cleanAns = stripOptionLabel(finalCorrectAnswer);
                const exactMatch = strippedOptions.find((opt: string) => stripOptionLabel(opt) === cleanAns);
                if (exactMatch) {
                    finalCorrectAnswer = exactMatch;
                } else {
                    const fuzzyMatch = strippedOptions.find((opt: string) => {
                        const cleanOpt = stripOptionLabel(opt);
                        return cleanOpt.includes(cleanAns) || cleanAns.includes(cleanOpt);
                    });
                    if (fuzzyMatch) finalCorrectAnswer = fuzzyMatch;
                }
            }

            if (type === 'short') {
                finalCorrectAnswer = item.correctAnswer?.toString().trim() || "";
            }

            return {
                ...item,
                type,
                id: uuidv4(),
                text: cleanedText,
                solution: cleanedSolution,
                level: finalLevel,
                points: item.points || (type === 'mcq' ? 0.25 : type === 'group-tf' ? 1.0 : 0.5),
                options: strippedOptions,
                correctAnswer: finalCorrectAnswer,
                subQuestions: item.subQuestions ? item.subQuestions.map((sq: any) => {
                    const sqExtract = extractLevelFromText(sq.text || "");
                    return { 
                        ...sq, 
                        id: uuidv4(),
                        text: stripOptionLabel(sqExtract.cleanText),
                        level: normalizeLevel(sq.level) || sqExtract.level,
                        correctAnswer: (sq.correctAnswer === 'True' || sq.correctAnswer === 'Đúng' || sq.correctAnswer === 'Đ' || sq.correctAnswer === 'T' || sq.correctAnswer === 'true' || sq.correctAnswer === '1') ? 'True' : 'False'
                    };
                }) : undefined
            };
        });
    };

    const formatGeminiError = (error: any): string => {
        const errorStr = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        if (errorStr.includes('503') || errorStr.includes('UNAVAILABLE') || errorStr.includes('high demand') || errorStr.includes('overloaded') || errorStr.includes('temporary')) {
            return "Máy chủ AI của Google đang chịu tải cao tạm thời (Lỗi 503 - High Demand).\n• Khắc phục: Hệ thống đã tự động thử các kênh dự phòng. Vui lòng bấm 'Tạo Đề' lại sau vài giây, hoặc cấu hình Gemini API Key riêng ở góc trên để được ưu tiên xử lý tốt nhất.";
        }
        if (errorStr.includes('403') || errorStr.includes('PERMISSION_DENIED') || errorStr.includes('permission')) {
            return "Lỗi 403 (Không có quyền truy cập): API Key chưa được cấp quyền gọi Gemini API.\n• Khắc phục: Bạn vui lòng vào https://aistudio.google.com/app/apikey tạo một API Key mới (miễn phí), hoặc nếu tạo trong Google Cloud Console thì cần bật (Enable) API 'Generative Language API' và kiểm tra API Key restrictions.";
        }
        if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('quota')) {
            return "Lỗi 429 (Vượt quá hạn mức): Tốc độ gọi AI bị giới hạn tạm thời. Vui lòng đợi khoảng 5-10 giây rồi bấm thử lại, hoặc nhập một API Key khác.";
        }
        if (errorStr.includes('API_KEY_INVALID') || errorStr.includes('API key not valid') || errorStr.includes('400')) {
            return "Lỗi 400: API Key không hợp lệ hoặc dữ liệu gửi đi không đúng định dạng. Vui lòng kiểm tra lại mã API Key.";
        }
        return errorStr;
    };

    const CANDIDATE_MODELS = [
        'gemini-2.5-flash',
        'gemini-flash-latest',
        'gemini-3.8-flash',
        'gemini-2.5-pro'
    ];

    /**
     * Gọi Gemini API với cơ chế tự động thử lại (Retry with Exponential Backoff)
     * và tự động chuyển đổi sang các mô hình dự phòng (Fallback Models) khi gặp lỗi 503 / 429 / Quá tải.
     */
    export const callGeminiWithRetryAndFallback = async (
        ai: GoogleGenAI,
        params: {
            contents: any;
            config?: any;
        },
        preferredModels: string[] = CANDIDATE_MODELS
    ): Promise<any> => {
        let lastError: any = null;

        for (let mIdx = 0; mIdx < preferredModels.length; mIdx++) {
            const model = preferredModels[mIdx];
            const maxRetries = 2;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const response = await ai.models.generateContent({
                        model,
                        contents: params.contents,
                        config: params.config
                    });
                    return response;
                } catch (err: any) {
                    lastError = err;
                    const errStr = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
                    const isOverloadedOrUnavailable = 
                        errStr.includes('503') || 
                        errStr.includes('UNAVAILABLE') || 
                        errStr.includes('high demand') || 
                        errStr.includes('RESOURCE_EXHAUSTED') || 
                        errStr.includes('429') ||
                        errStr.includes('500') ||
                        errStr.includes('502') ||
                        errStr.includes('504') ||
                        errStr.includes('overloaded');

                    console.warn(`[Gemini API] Model ${model} (lần ${attempt + 1}/${maxRetries + 1}) gặp lỗi:`, errStr);

                    // Nếu là lỗi sai Key (400, 403 không phải 503), throw ngay không retry
                    if (errStr.includes('API_KEY_INVALID') || errStr.includes('API key not valid') || (errStr.includes('403') && !errStr.includes('503'))) {
                        throw err;
                    }

                    // Nếu lỗi do máy chủ quá tải và còn lượt retry của model này
                    if (isOverloadedOrUnavailable && attempt < maxRetries) {
                        const delayMs = (attempt + 1) * 1200;
                        await new Promise(res => setTimeout(res, delayMs));
                        continue;
                    }

                    // Nếu đã hết lượt retry cho model này nhưng còn model dự phòng khác trong danh sách
                    if (isOverloadedOrUnavailable && mIdx < preferredModels.length - 1) {
                        console.log(`[Gemini API] Tự động chuyển đổi sang model dự phòng: ${preferredModels[mIdx + 1]}`);
                        break; // chuyển sang model tiếp theo
                    }

                    throw err;
                }
            }
        }

        throw lastError;
    };

    const getAiClient = (overrideApiKey?: string): GoogleGenAI => {
        const key = (overrideApiKey && overrideApiKey.trim()) ? overrideApiKey.trim() : (process.env.API_KEY || "");
        if (!key) {
            throw new Error("Chưa có Gemini API Key! Vui lòng nhập API Key của bạn vào ô bên cạnh nút tạo đề/soạn đề hoặc cấu hình trên hệ thống.");
        }
        return new GoogleGenAI({ apiKey: key });
    };

    export const generateQuizFromPrompt = async (config: any, customApiKey?: string): Promise<Question[]> => {
        const keyToUse = customApiKey || config.apiKey;
        const ai = getAiClient(keyToUse);
        
        let matrixPrompt = "";
        if (config.matrix) {
            matrixPrompt = `
    MA TRẬN ĐỘ KHÓ (PHÂN BỔ THEO % TỔNG SỐ CÂU):
    - Nhận biết (Easy/Knowledge): ${config.matrix.easy}% 
    - Thông hiểu (Medium/Understanding): ${config.matrix.medium}%
    - Vận dụng (Hard/Application): ${config.matrix.hard}%
    - Vận dụng cao (Very Hard/High Application): ${config.matrix.vhard}%
    Hãy phân bổ độ khó cho các câu hỏi sao cho tỉ lệ các mức độ sát với ma trận này nhất có thể.
    `;
        }

        const sourceInstruction = config.pdfBase64 
            ? "NGUỒN DỮ LIỆU: Hãy đọc kỹ file PDF được cung cấp. BẮT BUỘC chỉ được lấy dữ liệu, ý tưởng hoặc trích xuất trực tiếp các câu hỏi từ nội dung trong file PDF này để soạn đề. Không được tự ý chế tác nội dung nằm ngoài phạm vi tài liệu PDF trừ khi cần thiết để hoàn thiện cấu trúc câu hỏi."
            : "NGUỒN DỮ LIỆU: Sử dụng kho tri thức chuyên sâu của bạn về chương trình giáo dục phổ thông Việt Nam để soạn đề.";

        const prompt = `Bạn là chuyên gia soạn đề thi THPT quốc gia Việt Nam môn Toán/Lý/Hóa.
    ${sourceInstruction}

    YÊU CẦU CHI TIẾT:
    - Chủ đề: ${config.topic}.
    - Khối lớp: ${config.grade}.
    - Cấu trúc: ${config.part1Count} câu trắc nghiệm 4 lựa chọn (MCQ), ${config.part2Count} câu trắc nghiệm Đúng/Sai (Group-TF), ${config.part3Count} câu trả lời ngắn (Short).
    ${matrixPrompt}

    QUY TẮC KỸ THUẬT BẮT BUỘC:
    1. LaTeX & ĐƠN VỊ:
    - Bọc RIÊNG BIỆT từng biểu thức, công thức, ký hiệu toán/lý/hóa (VD: $\\Delta\\Phi$, $\\Omega$, $x^2$, $\\vec{v}$) trong cặp dấu $...$.
    - TUYỆT ĐỐI KHÔNG bọc cả câu văn bản tiếng Việt dài vào trong $...$. Chỉ bọc phần công thức.
    - Khi viết dấu suy ra, BẮT BUỘC dùng $\\Rightarrow$ (có dấu gạch chéo \\ và khoảng cách hai bên), TUYỆT ĐỐI KHÔNG viết 'Rightarrow' thiếu gạch chéo hoặc viết liền kề biến số.
    - Ký hiệu độ C viết là ^\\circ\\text{C} (VD: $10^\\circ\\text{C}$, $50^\\circ\\text{C}$, KHÔNG viết ^oC).
    - TUYỆT ĐỐI KHÔNG dùng thẻ \\text{...}, \\mathrm{...}, \\mbox{...} cho từ tiếng Việt có dấu.
    - Đơn vị đo (m/s, km/h, kg, g, N, J, W, V, A, Hz, s, min, h, cm, rad/s...): Viết dạng văn bản thường ngoài dấu $ (VD: '$v = 20$ m/s', '$m_1 = 1$ kg', '$Q_1 = 100$ J') hoặc viết trực tiếp ($20$ m/s).
    - Chỉ số trên/dưới: Viết trực tiếp (VD: $v_{max}$, $F_{ms}$, $m_1$, $T_2$).
    2. Solution (Lời giải): Lời giải đơn giản, súc tích bằng các gạch đầu dòng (- ...). Nêu công thức rồi ghi dấu bằng ra kết quả ngay ([Công thức] = [Kết quả]), TUYỆT ĐỐI BỎ QUA quá trình thay số/điền số vụn vặt vào giữa các phép tính để tránh rối mắt.
    3. MCQ: 'correctAnswer' phải là nội dung của phương án đúng (không kèm nhãn A, B, C, D). 'solution' gồm: - Áp dụng công thức: [Công thức] = [Kết quả]. - Chọn đáp án: [Phương án đúng].
    4. GROUP-TF: 
    - 'subQuestions' phải có chính xác 4 ý (a, b, c, d).
    - 'solution' trình bày 4 gạch đầu dòng ngắn gọn:
        - a) [Đúng/Sai]. Vì [Công thức] = [Kết quả]
        - b) [Đúng/Sai]. Vì [Công thức] = [Kết quả]
        ... (tương tự cho c, d)
    5. Options: Tuyệt đối KHÔNG bao gồm nhãn "A.", "B.", "C.", "D." vào nội dung phương án.
    6. JSON: Trả về kết quả dưới dạng mảng JSON chuẩn xác theo schema đã định.`;

        try {
            const contents = config.pdfBase64 
                ? {
                    parts: [
                        { inlineData: { mimeType: "application/pdf", data: config.pdfBase64 } },
                        { text: prompt }
                    ]
                }
                : prompt;

            const response = await callGeminiWithRetryAndFallback(ai, {
                contents: contents,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING },
                                text: { type: Type.STRING },
                                level: { type: Type.STRING, nullable: true },
                                points: { type: Type.NUMBER },
                                options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                                correctAnswer: { type: Type.STRING, nullable: true },
                                solution: { type: Type.STRING },
                                subQuestions: {
                                    type: Type.ARRAY,
                                    nullable: true,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            text: { type: Type.STRING },
                                            correctAnswer: { type: Type.STRING },
                                            level: { type: Type.STRING, nullable: true }
                                        },
                                        required: ["text", "correctAnswer"]
                                    }
                                }
                            },
                            required: ["type", "text", "points", "solution"]
                        }
                    }
                }
            });

            const textOutput = response.text || "[]";
            const rawData = safeParseJsonWithLatex(textOutput) || [];
            
            return processAIQuestions(rawData);
        } catch (error: any) {
            throw new Error("AI không thể tạo đề: " + formatGeminiError(error));
        }
    };

    export interface MatrixRequirementItem {
        chapterId?: string;
        chapterName: string;
        type: 'mcq' | 'group-tf' | 'short';
        level: QuestionLevel;
        count: number;
    }

    export interface MatrixProgressUpdate {
        phase: 'fetching' | 'checking' | 'generating' | 'normalizing' | 'completed';
        title: string;
        description: string;
        currentCount: number;
        totalCount: number;
        percent: number;
        currentChapter?: string;
        currentLevel?: QuestionLevel;
        currentType?: string;
    }

    export interface GenerateMatrixQuizConfig {
        subject?: string;
        grade: Grade | string;
        requirements: MatrixRequirementItem[];
        topic?: string;
        promptAdditions?: string;
        pdfBase64?: string;
        customApiKey?: string;
        onProgress?: (progress: MatrixProgressUpdate) => void;
    }

    export const generateQuestionsForMatrix = async (config: GenerateMatrixQuizConfig): Promise<Question[]> => {
        const validRequirements = config.requirements.filter(r => r.count > 0);
        if (validRequirements.length === 0) return [];

        const keyToUse = config.customApiKey;
        const ai = getAiClient(keyToUse);

        const totalQuestions = validRequirements.reduce((sum, r) => sum + r.count, 0);

        // Nếu số lượng câu hỏi cần sinh vượt quá 25 câu, chia thành các mẻ nhỏ để đảm bảo không bị quá tải token
        const chunks: MatrixRequirementItem[][] = [];
        let currentChunk: MatrixRequirementItem[] = [];
        let currentChunkCount = 0;

        for (const req of validRequirements) {
            if (currentChunkCount + req.count > 22 && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [req];
                currentChunkCount = req.count;
            } else {
                currentChunk.push(req);
                currentChunkCount += req.count;
            }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        const allGeneratedQuestions: Question[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunkReqs = chunks[i];
            const chunkTotal = chunkReqs.reduce((sum, r) => sum + r.count, 0);

            const chapterNames = [...new Set(chunkReqs.map(r => r.chapterName))].join(', ');
            const levels = [...new Set(chunkReqs.map(r => {
                const l = r.level;
                return l === 'B' ? 'Nhận biết' : (l === 'H' ? 'Thông hiểu' : (l === 'VD' ? 'Vận dụng' : 'Vận dụng cao'));
            }))].join(', ');

            if (config.onProgress) {
                const pct = Math.round((i / chunks.length) * 85) + 5;
                config.onProgress({
                    phase: 'generating',
                    title: `AI đang soạn câu hỏi mới (Đợt ${i + 1}/${chunks.length})`,
                    description: `Đang soạn ${chunkTotal} câu cho: "${chapterNames}" • Mức độ: [${levels}]`,
                    currentCount: allGeneratedQuestions.length,
                    totalCount: totalQuestions,
                    percent: pct,
                    currentChapter: chapterNames,
                    currentLevel: chunkReqs[0]?.level,
                    currentType: chunkReqs[0]?.type
                });
            }

            const reqDescription = chunkReqs.map((r, idx) => {
                const typeStr = r.type === 'mcq' ? 'Trắc nghiệm nhiều lựa chọn 4 phương án (type: "mcq")' 
                    : (r.type === 'group-tf' ? 'Trắc nghiệm Đúng/Sai gồm đúng 4 ý a, b, c, d (type: "group-tf")' 
                    : 'Trả lời ngắn điền số/kết quả (type: "short")');
                const levelStr = r.level === 'B' ? 'Nhận biết (level: "B")' 
                    : (r.level === 'H' ? 'Thông hiểu (level: "H")' 
                    : (r.level === 'VD' ? 'Vận dụng (level: "VD")' 
                    : 'Vận dụng cao (level: "VDC")'));
                return `  ${idx + 1}. Chương: "${r.chapterName}" | Loại: ${typeStr} | Mức độ: ${levelStr} -> BẮT BUỘC TẠO CHÍNH XÁC ${r.count} CÂU HỎI.`;
            }).join('\n');

            const sourceInstruction = config.pdfBase64
                ? "NGUỒN TÀI LIỆU PDF: Bạn được cung cấp tệp PDF. Hãy bóc tách hoặc sáng tạo câu hỏi bám sát tài liệu này. Nếu tài liệu không đủ các câu ở mức độ yêu cầu, hãy tự động soạn câu hỏi tương ứng với nội dung kiến thức trong tài liệu theo đúng mức độ."
                : "NGUỒN KIẾN THỨC: Bám sát khung chương trình giáo dục phổ thông mới (GDPT 2018) của Bộ GD&ĐT Việt Nam.";

            const prompt = `Bạn là chuyên gia khảo thí và ra đề thi chuẩn GDPT 2018 của Bộ Giáo dục & Đào tạo Việt Nam.
    ${sourceInstruction}

    THÔNG TIN ĐỀ THI:
    - Môn học: ${config.subject || 'Toán'}
    - Khối lớp: ${config.grade}
    - Tiêu đề / Chủ đề: ${config.topic || `Đề thi kiểm tra môn ${config.subject || 'Toán'} Khối ${config.grade}`}
    ${config.promptAdditions ? `\n- YÊU CẦU ĐẶC BIỆT CỦA GIÁO VIÊN:\n"""\n${config.promptAdditions}\n"""` : ''}

    DANH SÁCH CHI TIẾT CÁC CÂU CẦN TẠO THEO MA TRẬN (TỔNG CỘNG MẺ NÀY: ${chunkTotal} CÂU):
    ${reqDescription}

    QUY TẮC KỸ THUẬT BẮT BUỘC:
    1. MỖI CÂU HỎI trong mảng JSON trả về PHẢI CÓ ĐỦ:
    - "chapterName": Tên chương chính xác như đã yêu cầu ở trên.
    - "type": "mcq" | "group-tf" | "short".
    - "level": "B" | "H" | "VD" | "VDC".
    - "text": Nội dung câu hỏi.
    - "points": 0.25 (mcq), 1.0 (group-tf), 0.5 (short).
    - "solution": Lời giải súc tích, ngắn gọn, có công thức và kết luận.
    2. LOẠI CÂU:
    - "mcq": Cung cấp "options" gồm đúng 4 lựa chọn (không gắn nhãn A, B, C, D vào nội dung). "correctAnswer" là chuỗi phương án đúng.
    - "group-tf": Cung cấp "subQuestions" gồm chính xác 4 ý (a, b, c, d), mỗi ý có "text", "correctAnswer" ("True" hoặc "False"), "level".
    - "short": "correctAnswer" là đáp số ngắn gọn (dạng số thập phân, phân số, hoặc cụm ngắn).
    3. CÔNG THỨC VÀ KÝ HIỆU TOÁN/LÝ/HÓA:
    - BẮT BUỘC bọc riêng từng công thức, phương trình trong cặp dấu $...$ (VD: $x^2 + 2x - 3 = 0$, $F = ma$, $m_1 = 1$ kg).
    - TUYỆT ĐỐI KHÔNG bọc cả câu tiếng Việt vào dấu $...$.
    - Dấu suy ra BẮT BUỘC viết là $\\Rightarrow$ (có gạch chéo và khoảng cách). Không viết 'Rightarrow' dính liền.
    - Ký hiệu độ C viết là ^\\circ\\text{C} (VD: $10^\\circ\\text{C}$, $50^\\circ\\text{C}$, KHÔNG viết ^oC).
    - Tuyệt đối KHÔNG viết tiếng Việt có dấu trong thẻ \\text{} nếu không cần thiết.
    4. JSON: Trả về một mảng JSON các câu hỏi hợp lệ theo schema.`;

            try {
                const contents = config.pdfBase64
                    ? {
                        parts: [
                            { inlineData: { mimeType: "application/pdf", data: config.pdfBase64 } },
                            { text: prompt }
                        ]
                    }
                    : prompt;

                const response = await callGeminiWithRetryAndFallback(ai, {
                    contents: contents,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    chapterName: { type: Type.STRING },
                                    type: { type: Type.STRING },
                                    text: { type: Type.STRING },
                                    level: { type: Type.STRING, nullable: true },
                                    points: { type: Type.NUMBER, nullable: true },
                                    options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                                    correctAnswer: { type: Type.STRING, nullable: true },
                                    solution: { type: Type.STRING },
                                    subQuestions: {
                                        type: Type.ARRAY,
                                        nullable: true,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                text: { type: Type.STRING },
                                                correctAnswer: { type: Type.STRING },
                                                level: { type: Type.STRING, nullable: true }
                                            },
                                            required: ["text", "correctAnswer"]
                                        }
                                    }
                                },
                                required: ["type", "text", "solution"]
                            }
                        }
                    }
                });

                const textOutput = response.text || "[]";
                const rawData = safeParseJsonWithLatex(textOutput) || [];
                const processed = processAIQuestions(rawData);

                // Gán chapterId tương ứng theo chapterName nếu có trong yêu cầu
                const chapterMap = new Map<string, string>();
                chunkReqs.forEach(r => {
                    if (r.chapterId) chapterMap.set(r.chapterName.trim().toLowerCase(), r.chapterId);
                });

                processed.forEach(q => {
                    const cName = (q.chapterName || (q as any).chapter || '').trim();
                    const matchedId = chapterMap.get(cName.toLowerCase());
                    if (matchedId) q.chapterId = matchedId;
                    if (cName) {
                        q.chapterName = cName;
                        q.quizCategory = cName;
                    }
                    q.subject = config.subject;
                    q.quizGrade = config.grade as Grade;
                });

                allGeneratedQuestions.push(...processed);
            } catch (err: any) {
                console.error(`Lỗi generate chunk ${i + 1}/${chunks.length}:`, err);
                throw new Error(`AI không thể tạo câu hỏi theo ma trận: ${formatGeminiError(err)}`);
            }
        }

        return allGeneratedQuestions;
    };

    export const parseQuestionsFromPDF = async (base64Data: string, customApiKey?: string): Promise<Question[]> => {
    const ai = getAiClient(customApiKey);
    
    try {
        const response = await callGeminiWithRetryAndFallback(ai, {
            contents: {
                parts: [
                    { inlineData: { mimeType: "application/pdf", data: base64Data } },
                    { text: EXTRACTION_INSTRUCTION }
                ]
            },
            config: { 
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            type: { type: Type.STRING },
                            text: { type: Type.STRING },
                            level: { type: Type.STRING, nullable: true },
                            points: { type: Type.NUMBER },
                            options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                            correctAnswer: { type: Type.STRING, nullable: true },
                            solution: { type: Type.STRING },
                            subQuestions: {
                                type: Type.ARRAY,
                                nullable: true,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        text: { type: Type.STRING },
                                        correctAnswer: { type: Type.STRING },
                                        level: { type: Type.STRING, nullable: true }
                                    },
                                    required: ["text", "correctAnswer"]
                                }
                            }
                        },
                        required: ["type", "text", "solution"]
                    }
                }
            }
        });

        const textOutput = response.text || "[]";
        const rawData = safeParseJsonWithLatex(textOutput);
        
        return processAIQuestions(rawData);
    } catch (error: any) {
        throw new Error("Lỗi đọc PDF: " + formatGeminiError(error));
    }
    };

    export const parseQuestionsFromJSON = (input: string | any): { questions: Question[]; quizTitle?: string; grade?: Grade; category?: string; durationMinutes?: number } => {
        let parsed: any;
        if (typeof input === 'string') {
            try {
                parsed = safeParseJsonWithLatex(input);
            } catch (e: any) {
                throw new Error("Cấu trúc file hoặc chuỗi JSON không hợp lệ. Vui lòng kiểm tra lại cú pháp JSON!");
            }
        } else {
            parsed = input;
        }

        let rawQuestions: any[] = [];
        let quizTitle: string | undefined;
        let grade: Grade | undefined;
        let category: string | undefined;
        let durationMinutes: number | undefined;

        if (Array.isArray(parsed)) {
            rawQuestions = parsed;
        } else if (parsed && typeof parsed === 'object') {
            const infoObj = parsed.exam_info || parsed.info || parsed.metadata || parsed;
            
            if (infoObj.title || infoObj.quizTitle || infoObj.name || parsed.title || parsed.quizTitle || parsed.name) {
                quizTitle = infoObj.title || infoObj.quizTitle || infoObj.name || parsed.title || parsed.quizTitle || parsed.name;
            }
            if (infoObj.grade || parsed.grade) grade = String(infoObj.grade || parsed.grade) as Grade;
            if (infoObj.category || infoObj.subject || parsed.category || parsed.subject) category = infoObj.category || infoObj.subject || parsed.category || parsed.subject;
            
            const rawDur = infoObj.durationMinutes || infoObj.duration || infoObj.timeLimit || parsed.durationMinutes || parsed.duration || parsed.timeLimit;
            if (rawDur) {
                if (typeof rawDur === 'number') {
                    durationMinutes = rawDur;
                } else if (typeof rawDur === 'string') {
                    const match = rawDur.match(/\d+/);
                    if (match) durationMinutes = parseInt(match[0], 10);
                }
            }

            // Extract questions from parts array or root questions arrays
            if (Array.isArray(parsed.parts)) {
                parsed.parts.forEach((part: any) => {
                    if (Array.isArray(part.questions)) {
                        rawQuestions.push(...part.questions);
                    } else if (Array.isArray(part.data)) {
                        rawQuestions.push(...part.data);
                    } else if (Array.isArray(part.items)) {
                        rawQuestions.push(...part.items);
                    }
                });
            }
            
            if (rawQuestions.length === 0) {
                if (Array.isArray(parsed.questions)) {
                    rawQuestions = parsed.questions;
                } else if (Array.isArray(parsed.data)) {
                    rawQuestions = parsed.data;
                } else if (Array.isArray(parsed.items)) {
                    rawQuestions = parsed.items;
                } else if (parsed.quiz && Array.isArray(parsed.quiz.questions)) {
                    rawQuestions = parsed.quiz.questions;
                } else {
                    const possibleArray = Object.values(parsed).find(val => Array.isArray(val));
                    if (possibleArray) {
                        rawQuestions = possibleArray as any[];
                    }
                }
            }
        }

        if (!rawQuestions || rawQuestions.length === 0) {
            throw new Error("Không tìm thấy danh sách câu hỏi hợp lệ trong dữ liệu JSON!");
        }

        const normalizedRaw = rawQuestions.map((q: any) => {
            let typeStr = (q.type || q.qtype || q.questionType || q.question_type || '').toLowerCase().trim();
            let type = 'mcq';
            if (typeStr === 'mc' || typeStr === 'part1' || typeStr.includes('mcq') || typeStr.includes('trac_nghiem') || typeStr.includes('multiple')) {
                type = 'mcq';
            } else if (typeStr === 'tf' || typeStr === 'part2' || typeStr.includes('group') || typeStr.includes('dung_sai') || typeStr.includes('true_false')) {
                type = 'group-tf';
            } else if (typeStr === 'sa' || typeStr === 'part3' || typeStr.includes('short') || typeStr.includes('ngan') || typeStr.includes('tra_loi')) {
                type = 'short';
            } else {
                if (q.subQuestions || q.sub_questions || q.statements || q.y_con) {
                    type = 'group-tf';
                } else if (q.options || q.choices || q.phuong_an) {
                    type = 'mcq';
                } else {
                    type = 'short';
                }
            }

            // Raw options: can be Array or Object (e.g. { "A": "...", "B": "..." })
            const rawOptions = q.options || q.choices || q.phuong_an || q.dap_an_lua_chon || q.answers;
            let optionsObj: Record<string, any> | null = null;
            let rawOptionsArray: any[] | null = null;

            if (Array.isArray(rawOptions)) {
                rawOptionsArray = rawOptions;
            } else if (rawOptions && typeof rawOptions === 'object') {
                optionsObj = rawOptions;
                rawOptionsArray = Object.values(rawOptions);
            }

            let subQuestions = q.subQuestions || q.sub_questions || q.statements || q.y_con;
            
            // Trường hợp câu hỏi Đúng/Sai (TF) mà danh sách mệnh đề nằm trong q.options
            if (type === 'group-tf' && !subQuestions && rawOptionsArray && Array.isArray(rawOptionsArray)) {
                subQuestions = rawOptionsArray;
            }

            if (Array.isArray(subQuestions)) {
                subQuestions = subQuestions.map((sq: any) => {
                    let ans = sq.correctAnswer ?? sq.answer ?? sq.dap_an ?? sq.isTrue ?? sq.isCorrect ?? sq.correct ?? sq.correct_answer;
                    if (ans === true || ans === 'True' || ans === 'true' || ans === 'Đ' || ans === 'Đúng' || ans === '1') {
                        ans = 'True';
                    } else {
                        ans = 'False';
                    }
                    const sqText = sq.text || sq.content || sq.noi_dung || sq.question || '';
                    const sqLevel = normalizeLevel(sq.level || sq.muc_do || sq.do_kho);
                    return {
                        text: sqText.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$'),
                        correctAnswer: ans,
                        level: sqLevel
                    };
                });
            }

            let rawCorrectVal = q.correct_answer ?? q.correctAnswer ?? q.answer ?? q.correct ?? q.dap_an_dung ?? q.dap_an ?? q.correctOptionIndex ?? q.correct_option_index ?? q.correctIndex ?? q.correct_index ?? q.answerIndex;

            let options: string[] | undefined = undefined;
            let correctAnswer = '';

            if (type === 'mcq' && rawOptionsArray) {
                options = rawOptionsArray.map((opt: any) => {
                    const str = typeof opt === 'string' ? opt : (opt.text || opt.content || opt.label || String(opt));
                    return str.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$');
                });

                // 1. Tìm trong thuộc tính isCorrect của option object
                const correctObj = rawOptionsArray.find((opt: any) => typeof opt === 'object' && (opt.isCorrect === true || opt.is_correct === true || opt.correct === true));
                if (correctObj) {
                    const str = typeof correctObj === 'string' ? correctObj : (correctObj.text || correctObj.content || correctObj.label || String(correctObj));
                    correctAnswer = str.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$');
                } else if (rawCorrectVal !== undefined && rawCorrectVal !== null && rawCorrectVal !== '') {
                    // 2. Nếu optionsObj dạng { "A": "...", "B": "..." } và rawCorrectVal = "A" hay "D"
                    if (optionsObj && typeof rawCorrectVal === 'string' && optionsObj[rawCorrectVal.trim()] !== undefined) {
                        const matchedVal = optionsObj[rawCorrectVal.trim()];
                        const str = typeof matchedVal === 'string' ? matchedVal : (matchedVal.text || matchedVal.content || String(matchedVal));
                        correctAnswer = str.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$');
                    } else if (typeof rawCorrectVal === 'number') {
                        if (rawCorrectVal >= 0 && rawCorrectVal < options.length) {
                            correctAnswer = options[rawCorrectVal];
                        } else {
                            correctAnswer = String(rawCorrectVal);
                        }
                    } else if (typeof rawCorrectVal === 'string') {
                        const trimmed = rawCorrectVal.trim();
                        if (/^\d+$/.test(trimmed)) {
                            const idx = parseInt(trimmed, 10);
                            if (idx >= 0 && idx < options.length) {
                                correctAnswer = options[idx];
                            } else {
                                correctAnswer = trimmed;
                            }
                        } else if (/^[A-Da-d][\.\:\s]*$/.test(trimmed)) {
                            const letter = trimmed.charAt(0).toUpperCase();
                            const idx = letter.charCodeAt(0) - 65;
                            if (idx >= 0 && idx < options.length) {
                                correctAnswer = options[idx];
                            } else {
                                correctAnswer = trimmed;
                            }
                        } else {
                            correctAnswer = trimmed;
                        }
                    }
                }
            } else {
                if (rawCorrectVal !== undefined && rawCorrectVal !== null) {
                    correctAnswer = String(rawCorrectVal).trim();
                }
            }

            // Question text: hợp nhất context (ngữ cảnh/đoạn văn) + câu hỏi
            let rawText = '';
            const contextStr = q.context || q.doan_van || q.bai_doc || '';
            const mainTextStr = q.text || q.question || q.content || q.cau_hoi || q.title || '';

            if (contextStr && mainTextStr) {
                rawText = `${contextStr}\n${mainTextStr}`;
            } else {
                rawText = mainTextStr || contextStr || '';
            }

            const rawSolution = q.solution || q.explanation || q.loi_giai || q.huong_dan_giai || q.guide || '';

            return {
                ...q,
                type,
                text: rawText.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$'),
                options: type === 'mcq' ? options : undefined,
                correctAnswer: typeof correctAnswer === 'string' ? correctAnswer.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$') : String(correctAnswer),
                solution: rawSolution.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$'),
                points: q.points || q.score || q.diem || (type === 'mcq' ? 0.25 : 1.0),
                subQuestions: type === 'group-tf' ? subQuestions : undefined
            };
        });

        const questions = processAIQuestions(normalizedRaw);

        return {
            questions,
            quizTitle,
            grade,
            category,
            durationMinutes
        };
    };

    export const parseQuestionsFromText = async (rawText: string, customApiKey?: string): Promise<Question[]> => {
        const ai = getAiClient(customApiKey);
        
        try {
            const response = await callGeminiWithRetryAndFallback(ai, {
                contents: `${EXTRACTION_INSTRUCTION}\n\nNỘI DUNG VĂN BẢN CẦN TRÍCH XUẤT:\n${rawText}`,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING },
                                text: { type: Type.STRING },
                                points: { type: Type.NUMBER },
                                options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                                correctAnswer: { type: Type.STRING, nullable: true },
                                solution: { type: Type.STRING },
                                subQuestions: {
                                    type: Type.ARRAY,
                                    nullable: true,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            text: { type: Type.STRING },
                                            correctAnswer: { type: Type.STRING }
                                        },
                                        required: ["text", "correctAnswer"]
                                    }
                                }
                            },
                            required: ["type", "text", "solution"]
                        }
                    }
                }
            });

            const textOutput = response.text || "[]";
            const rawData = safeParseJsonWithLatex(textOutput) || [];
            
            return processAIQuestions(rawData);
        } catch (error: any) {
            throw new Error("Lỗi bóc tách văn bản: " + formatGeminiError(error));
        }
    };

    export const solveQuestionWithAI = async (
        question: Question,
        subject: string = 'Toán',
        grade: string = '12',
        customApiKey?: string
    ): Promise<{ solution: string; correctAnswer?: string }> => {
        const ai = getAiClient(customApiKey);

        let questionDesc = `NỘI DUNG CÂU HỎI:\n${question.text}\n`;
        if (question.type === 'mcq' && question.options) {
            questionDesc += `CÁC PHƯƠNG ÁN:\n${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}\n`;
            if (question.correctAnswer) {
                questionDesc += `ĐÁP ÁN ĐÃ CHỌN: ${question.correctAnswer}\n`;
            }
        } else if (question.type === 'group-tf' && question.subQuestions) {
            questionDesc += `CÁC Ý TRẮC NGHIỆM ĐÚNG/SAI:\n${question.subQuestions.map((sq, i) => `${String.fromCharCode(97 + i)}) ${sq.text} (Hiện tại: ${sq.correctAnswer === 'True' ? 'Đúng' : 'Sai'})`).join('\n')}\n`;
        } else if (question.type === 'short') {
            if (question.correctAnswer) {
                questionDesc += `ĐÁP SỐ ĐÃ NHẬP: ${question.correctAnswer}\n`;
            }
        }

        const prompt = `Bạn là giáo viên chuyên môn môn ${subject} khối lớp ${grade} THPT Việt Nam.
    NHIỆM VỤ: Hãy giải bài toán/câu hỏi sau một cách ngắn gọn, sư phạm, bước giải súc tích, mạch lạc và chính xác 100%.

    ${questionDesc}

    YÊU CẦU LỜI GIẢI ('solution') - BẮT BUỘC:
    1. PHONG CÁCH & QUY TẮC CÔNG THỨC:
    - Trình bày đơn giản bằng các gạch đầu dòng (- ...).
    - Nêu công thức/định luật rồi ghi dấu bằng ra kết quả luôn (Dạng: [Công thức] = [Kết quả]). 
    - TUYỆT ĐỐI BỎ QUA quá trình điền/thay thế số chi tiết, vụn vặt vào giữa các phép tính để tránh rối mắt.
    2. CẤU TRÚC THEO DẠNG:
    - Với MCQ (Trắc nghiệm 4 lựa chọn):
        - Áp dụng công thức: [Công thức] = [Kết quả].
        - Chọn đáp án: [Phương án đúng].
    - Với GROUP-TF (Đúng/Sai): BẮT BUỘC giải thích cho cả 4 ý theo gạch đầu dòng ngắn gọn:
        - a) [Đúng/Sai]. Vì [Công thức] = [Kết quả].
        - b) [Đúng/Sai]. Vì [Công thức] = [Kết quả đúng].
        - c) [Đúng/Sai]. Vì [Công thức / Lý do ngắn gọn].
        - d) [Đúng/Sai]. Vì [Công thức / Lý do ngắn gọn].
    - Với SHORT (Trả lời ngắn):
        - [Công thức/Định luật] = [Kết quả].
        - Đáp số: [Số].
    3. CÔNG THỨC, KÝ HIỆU & ĐƠN VỊ:
    - Mọi công thức, biểu thức bọc RIÊNG BIỆT trong $...$. TUYỆT ĐỐI KHÔNG bọc cả đoạn văn hoặc cả câu tiếng Việt vào $...$.
    - Dấu suy ra BẮT BUỘC viết có dấu gạch chéo \\ và khoảng cách: $\\Rightarrow$ hoặc \\Rightarrow (TUYỆT ĐỐI KHÔNG viết Rightarrow thiếu gạch chéo hoặc viết dính liền biến số).
    - Ký hiệu độ C viết là ^\\circ\\text{C} (VD: $10^\\circ\\text{C}$, $50^\\circ\\text{C}$, KHÔNG viết ^oC).
    - TUYỆT ĐỐI KHÔNG dùng \\text{...}, \\mathrm{...} cho các từ tiếng Việt có dấu trong công thức.
    - Đơn vị viết bên ngoài dấu $ (VD: '$v = 20$ m/s', '$m_1 = 1$ kg', '$Q_1 = 100$ J').
    - Chỉ số dưới viết trực tiếp (VD: $v_{max}$, $F_{ms}$, $m_1$, $T_2$).
    4. ĐÁP ÁN ĐÚNG ('correctAnswer'): Nếu câu hỏi chưa có đáp án hoặc bạn tìm ra đáp án đúng, hãy cung cấp nội dung đáp án đúng.`;

        try {
            const response = await callGeminiWithRetryAndFallback(ai, {
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            solution: { type: Type.STRING },
                            correctAnswer: { type: Type.STRING, nullable: true }
                        },
                        required: ["solution"]
                    }
                }
            });

            const raw = safeParseJsonWithLatex(response.text || "{}") || {};
            let sol = raw.solution || "";
            sol = normalizeFullText(sol);
            sol = cleanLatexTextTags(sol);
            sol = unpackAccidentallyMathWrappedParagraph(sol);

            let ans = raw.correctAnswer ? cleanLatexTextTags(normalizeFullText(raw.correctAnswer)) : undefined;

            return {
                solution: sol,
                correctAnswer: ans
            };
        } catch (error: any) {
            throw new Error("Lỗi AI giải câu hỏi: " + formatGeminiError(error));
        }
    };

    export interface SolveProgressUpdate {
        current: number;
        total: number;
        percent: number;
        status: 'checking' | 'solving' | 'skipped' | 'done';
        message: string;
        level?: string;
        questionTextSnippet?: string;
    }

    export const solveMultipleQuestionsWithAI = async (
        questions: Question[],
        subject: string = 'Toán',
        grade: string = '12',
        customApiKey?: string,
        onProgress?: (progress: SolveProgressUpdate) => void,
        forceSolveAll: boolean = false
    ): Promise<Question[]> => {
        const updated: Question[] = [];
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const hasExistingSolution = Boolean(
                q.solution && 
                q.solution.trim().length > 0 && 
                !q.solution.includes('Chưa có lời giải')
            );

            // NẾU CÂU HỎI ĐÃ CÓ LỜI GIẢI SẴN: Giữ nguyên từ dữ liệu gốc, không gọi AI
            if (!forceSolveAll && hasExistingSolution) {
                updated.push(q);
                if (onProgress) {
                    const pct = Math.round(((i + 1) / questions.length) * 100);
                    onProgress({
                        current: i + 1,
                        total: questions.length,
                        percent: pct,
                        status: 'skipped',
                        message: `Câu ${i + 1} (${q.level ? `Mức độ ${q.level}` : 'Có sẵn'}): Đang lấy dữ liệu - Đã có sẵn lời giải, giữ nguyên.`,
                        level: q.level,
                        questionTextSnippet: q.text.substring(0, 50)
                    });
                }
                continue;
            }

            // CÂU HỎI CHƯA CÓ LỜI GIẢI: AI phân tích và soạn lời giải mới
            if (onProgress) {
                const pct = Math.round((i / questions.length) * 100);
                onProgress({
                    current: i + 1,
                    total: questions.length,
                    percent: pct,
                    status: 'solving',
                    message: `Câu ${i + 1} (${q.level ? `Mức độ ${q.level}` : 'Chưa có'}): Đang soạn lời giải mới theo chuẩn sư phạm...`,
                    level: q.level,
                    questionTextSnippet: q.text.substring(0, 50)
                });
            }

            try {
                const res = await solveQuestionWithAI(q, subject, grade, customApiKey);
                updated.push({
                    ...q,
                    solution: res.solution || q.solution,
                    correctAnswer: (q.type !== 'group-tf' && res.correctAnswer && !q.correctAnswer) ? res.correctAnswer : q.correctAnswer
                });
            } catch (e) {
                console.error(`Lỗi giải câu ${i + 1}:`, e);
                updated.push(q);
            }

            if (onProgress) {
                const pct = Math.round(((i + 1) / questions.length) * 100);
                onProgress({
                    current: i + 1,
                    total: questions.length,
                    percent: pct,
                    status: 'done',
                    message: `Câu ${i + 1}: Đã hoàn tất soạn lời giải!`,
                    level: q.level,
                    questionTextSnippet: q.text.substring(0, 50)
                });
            }
        }
        return updated;
    };

    export interface QuestionChapterAssignment {
        questionId: string;
        chapterId?: string;
        chapterName: string;
    }

    /**
     * Nhận diện nhanh chương học từ thẻ tag, tên chương và từ khóa đặc thù (0.001s, không tốn token AI)
     */
    const detectChapterFast = (
        q: Question,
        chapters: { id: string; name: string; grade?: string; subject?: string }[],
        subject?: string,
        grade?: string
    ): { chapterId?: string; chapterName?: string } | null => {
        if (!chapters || chapters.length === 0) return null;
        const textToCheck = `${q.text || ''} ${q.solution || ''} ${q.chapterName || ''}`.toLowerCase();

        // 1. Quét thẻ Tag chương rõ ràng: [Chương 1: ...], [Chương I], [Chủ đề: ...]
        const tagRegex = /(?:\[|\(|\<)\s*(?:chương|chuong|chủ đề|chu de|bài)\s*([0-9ivx]+)?\s*[:\-–]?\s*([^\]\)>]+)\s*(?:\]|\)|\>)/i;
        const tagMatch = `${q.text || ''} ${q.solution || ''}`.match(tagRegex);
        if (tagMatch) {
            const rawTag = tagMatch[0].toLowerCase();
            const tagContent = tagMatch[2] ? tagMatch[2].toLowerCase().trim() : '';
            for (const c of chapters) {
                const cNameLower = c.name.toLowerCase();
                if (cNameLower.includes(tagContent) || (tagContent && tagContent.includes(cNameLower)) || textToCheck.includes(cNameLower)) {
                    return { chapterId: c.id, chapterName: c.name };
                }
            }
        }

        // 2. So khớp trực tiếp tên chương trong danh sách
        for (const c of chapters) {
            const cleanCName = c.name.replace(/^chương\s*[0-9ivx]+[:\.\-–\s]*/i, '').trim().toLowerCase();
            if (cleanCName.length > 4 && textToCheck.includes(cleanCName)) {
                return { chapterId: c.id, chapterName: c.name };
            }
        }

        // 3. Hệ thống từ khóa đặc thù theo môn học và chương trình chuẩn
        const sLower = (subject || '').toLowerCase();
        
        // --- TOÁN HỌC ---
        if (sLower.includes('toán') || sLower.includes('math')) {
            const mathScores: { chapter: typeof chapters[0]; score: number }[] = [];
            for (const c of chapters) {
                const cName = c.name.toLowerCase();
                let score = 0;

                // Hàm số & Đạo hàm
                if (cName.includes('hàm số') || cName.includes('đạo hàm') || cName.includes('khảo sát')) {
                    if (textToCheck.includes('đồng biến') || textToCheck.includes('nghịch biến')) score += 3;
                    if (textToCheck.includes('cực trị') || textToCheck.includes('cực đại') || textToCheck.includes('cực tiểu')) score += 3;
                    if (textToCheck.includes('tiệm cận đứng') || textToCheck.includes('tiệm cận ngang') || textToCheck.includes('tiệm cận')) score += 3;
                    if (textToCheck.includes('bảng biến thiên') || textToCheck.includes('đồ thị của hàm số')) score += 2;
                    if (textToCheck.includes('giá trị lớn nhất') || textToCheck.includes('giá trị nhỏ nhất') || textToCheck.includes('max') || textToCheck.includes('min')) score += 2;
                    if (textToCheck.includes('y = f(x)') || textToCheck.includes('f\'(x)')) score += 1;
                }
                // Nguyên hàm & Tích phân
                else if (cName.includes('nguyên hàm') || cName.includes('tích phân') || cName.includes('tich phan')) {
                    if (textToCheck.includes('\\int') || textToCheck.includes('nguyên hàm') || textToCheck.includes('tích phân')) score += 4;
                    if (textToCheck.includes('diện tích hình phẳng') || textToCheck.includes('thể tích khối tròn xoay')) score += 3;
                }
                // Tọa độ không gian (Oxyz)
                else if (cName.includes('không gian') || cName.includes('tọa độ') || cName.includes('toạ độ') || cName.includes('oxyz') || cName.includes('vectơ')) {
                    if (textToCheck.includes('oxyz') || textToCheck.includes('o, \\vec{i}') || textToCheck.includes('không gian với hệ tọa độ')) score += 4;
                    if (textToCheck.includes('vectơ pháp tuyến') || textToCheck.includes('vectơ chỉ phương')) score += 3;
                    if (textToCheck.includes('phương trình mặt phẳng') || textToCheck.includes('phương trình đường thẳng') || textToCheck.includes('mặt cầu')) score += 3;
                    if (textToCheck.includes('toạ độ của điểm') || textToCheck.includes('tọa độ điểm') || textToCheck.includes('khoảng cách từ điểm')) score += 2;
                }
                // Số phức
                else if (cName.includes('số phức') || cName.includes('so phuc')) {
                    if (textToCheck.includes('số phức') || textToCheck.includes('phần thực') || textToCheck.includes('phần ảo') || textToCheck.includes('môđun') || textToCheck.includes('số phức liên hợp')) score += 4;
                    if (textToCheck.includes('z = a + bi') || textToCheck.includes('\\bar{z}') || textToCheck.includes('|z|')) score += 3;
                }
                // Xác suất & Thống kê
                else if (cName.includes('xác suất') || cName.includes('thống kê') || cName.includes('số liệu') || cName.includes('phân tán')) {
                    if (textToCheck.includes('xác suất') || textToCheck.includes('biến cố') || textToCheck.includes('không gian mẫu')) score += 4;
                    if (textToCheck.includes('kỳ vọng') || textToCheck.includes('phương sai') || textToCheck.includes('độ lệch chuẩn') || textToCheck.includes('mẫu số liệu') || textToCheck.includes('khoảng biến thiên')) score += 4;
                }

                if (score > 0) {
                    mathScores.push({ chapter: c, score });
                }
            }

            mathScores.sort((a, b) => b.score - a.score);
            if (mathScores.length > 0 && mathScores[0].score >= 3) {
                return { chapterId: mathScores[0].chapter.id, chapterName: mathScores[0].chapter.name };
            }
        }

        // --- VẬT LÍ ---
        if (sLower.includes('lý') || sLower.includes('vật lí') || sLower.includes('vật lý') || sLower.includes('physic')) {
            for (const c of chapters) {
                const cName = c.name.toLowerCase();
                // Vật lí nhiệt
                if (cName.includes('nhiệt') && (textToCheck.includes('nhiệt độ') || textToCheck.includes('nhiệt dung riêng') || textToCheck.includes('nóng chảy') || textToCheck.includes('hóa hơi') || textToCheck.includes('nhiệt lượng') || textToCheck.includes('nội năng'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                // Khí lí tưởng
                if ((cName.includes('khí') || cName.includes('lí tưởng')) && (textToCheck.includes('chất khí') || textToCheck.includes('khí lí tưởng') || textToCheck.includes('định luật boyle') || textToCheck.includes('charles') || textToCheck.includes('áp suất p') || textToCheck.includes('đẳng nhiệt') || textToCheck.includes('đẳng áp'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                // Từ trường
                if (cName.includes('từ trường') && (textToCheck.includes('từ trường') || textToCheck.includes('cảm ứng từ') || textToCheck.includes('lực từ') || textToCheck.includes('lorentz') || textToCheck.includes('từ thông') || textToCheck.includes('cảm ứng điện từ'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                // Hạt nhân nguyên tử
                if (cName.includes('hạt nhân') && (textToCheck.includes('hạt nhân') || textToCheck.includes('phóng xạ') || textToCheck.includes('chu kỳ bán rã') || textToCheck.includes('độ hụt khối') || textToCheck.includes('năng lượng liên kết') || textToCheck.includes('phân hạch'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                // Dao động cơ
                if (cName.includes('dao động') && (textToCheck.includes('dao động điều hòa') || textToCheck.includes('con lắc lò xo') || textToCheck.includes('con lắc đơn') || textToCheck.includes('biên độ') || textToCheck.includes('tần số góc'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                // Sóng
                if (cName.includes('sóng') && (textToCheck.includes('bước sóng') || textToCheck.includes('giao thoa sóng') || textToCheck.includes('sóng dừng') || textToCheck.includes('sóng âm') || textToCheck.includes('mức cường độ âm'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                // Dòng điện
                if ((cName.includes('điện') || cName.includes('mạch')) && (textToCheck.includes('dòng điện xoay chiều') || textToCheck.includes('điện áp xoay chiều') || textToCheck.includes('mạch rlc') || textToCheck.includes('hệ số công suất') || textToCheck.includes('cuộn cảm'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
            }
        }

        // --- HÓA HỌC ---
        if (sLower.includes('hóa') || sLower.includes('chem')) {
            for (const c of chapters) {
                const cName = c.name.toLowerCase();
                if ((cName.includes('este') || cName.includes('lipit')) && (textToCheck.includes('este') || textToCheck.includes('lipit') || textToCheck.includes('chất béo') || textToCheck.includes('xà phòng hóa') || textToCheck.includes('triglyxerit') || textToCheck.includes('etyl axetat'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                if (cName.includes('cacbo') && (textToCheck.includes('glucozơ') || textToCheck.includes('fructozơ') || textToCheck.includes('saccarozơ') || textToCheck.includes('tinh bột') || textToCheck.includes('xenlulozơ'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                if ((cName.includes('amin') || cName.includes('nitơ') || cName.includes('protein')) && (textToCheck.includes('amin') || textToCheck.includes('amino axit') || textToCheck.includes('peptit') || textToCheck.includes('protein') || textToCheck.includes('anilin') || textToCheck.includes('glyxin') || textToCheck.includes('alanin'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                if (cName.includes('polime') && (textToCheck.includes('polime') || textToCheck.includes('trùng hợp') || textToCheck.includes('trùng ngưng') || textToCheck.includes('cao su') || textToCheck.includes('tơ nilon'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                if ((cName.includes('pin') || cName.includes('điện phân')) && (textToCheck.includes('pin điện') || textToCheck.includes('điện phân') || textToCheck.includes('thế điện cực') || textToCheck.includes('ăn mòn điện hóa'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                if (cName.includes('kim loại') && (textToCheck.includes('kim loại kiềm') || textToCheck.includes('kiềm thổ') || textToCheck.includes('nhôm') || textToCheck.includes('sắt') || textToCheck.includes('dãy điện hóa') || textToCheck.includes('hợp kim'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
            }
        }

        // --- SINH HỌC ---
        if (sLower.includes('sinh') || sLower.includes('bio')) {
            for (const c of chapters) {
                const cName = c.name.toLowerCase();
                if (cName.includes('di truyền') && (textToCheck.includes('gen') || textToCheck.includes('alen') || textToCheck.includes('nhiễm sắc thể') || textToCheck.includes('đột biến') || textToCheck.includes('adn') || textToCheck.includes('marn') || textToCheck.includes('phép lai'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                if (cName.includes('tiến hóa') && (textToCheck.includes('tiến hóa') || textToCheck.includes('chọn lọc tự nhiên') || textToCheck.includes('dacuyn') || textToCheck.includes('thích nghi'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
                if (cName.includes('sinh thái') && (textToCheck.includes('quần thể') || textToCheck.includes('quần xã') || textToCheck.includes('hệ sinh thái') || textToCheck.includes('chuỗi thức ăn') || textToCheck.includes('lưới thức ăn'))) {
                    return { chapterId: c.id, chapterName: c.name };
                }
            }
        }

        return null;
    };

    /**
     * Dùng Hybrid AI (Nhận diện nhanh thẻ tag/từ khóa + AI Flash siêu nhẹ)
     * tự động phân loại vào chương học tương ứng trong tích tắc.
     */
    export const classifyQuestionsIntoChapters = async (
        questions: Question[],
        chapters: { id: string; name: string; grade?: string; subject?: string }[],
        options?: {
            subject?: string;
            grade?: string;
            customApiKey?: string;
        }
    ): Promise<QuestionChapterAssignment[]> => {
        if (!questions || questions.length === 0) return [];
        if (!chapters || chapters.length === 0) return [];

        const results: QuestionChapterAssignment[] = [];
        const questionsNeedingAi: Question[] = [];

        // BƯỚC 1: Quét nhận diện nhanh cực tốc qua Thẻ Tag & Từ khóa đặc thù (0.001s)
        questions.forEach(q => {
            const fastMatch = detectChapterFast(q, chapters, options?.subject, options?.grade);
            if (fastMatch && fastMatch.chapterName) {
                results.push({
                    questionId: q.id,
                    chapterId: fastMatch.chapterId,
                    chapterName: fastMatch.chapterName
                });
            } else {
                questionsNeedingAi.push(q);
            }
        });

        // NẾU TẤT CẢ ĐÃ ĐƯỢC NHẬN DIỆN NHANH: Trả về kết quả ngay tức thì (0ms, không cần gọi AI)!
        if (questionsNeedingAi.length === 0) {
            return results;
        }

        // BƯỚC 2: Chỉ gửi số lượng ít các câu chưa nhận diện được cho AI Gemini Flash xử lý siêu nhẹ
        const ai = getAiClient(options?.customApiKey);
        const chaptersListText = chapters.map((c, idx) => `${idx + 1}. [ID: "${c.id}"] "${c.name}"`).join('\n');

        // Nén ngắn gọn nội dung để AI phản hồi trong 1-2 giây
        const compactQuestions = questionsNeedingAi.map((q, idx) => {
            const shortText = q.text ? q.text.replace(/\s+/g, ' ').substring(0, 150) : '';
            return `Q${idx + 1}[ID:"${q.id}"]: ${shortText}`;
        }).join('\n');

        const prompt = `Phân loại ${questionsNeedingAi.length} câu hỏi môn ${options?.subject || 'Toán'} lớp ${options?.grade || '12'} vào danh sách chương:
DANH SÁCH CHƯƠNG:
${chaptersListText}

CÂU HỎI:
${compactQuestions}

Trả về JSON array chính xác: [{"questionId": "ID", "chapterId": "ID_chuong", "chapterName": "Ten_chuong"}]`;

        try {
            const response = await callGeminiWithRetryAndFallback(ai, {
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                questionId: { type: Type.STRING },
                                chapterId: { type: Type.STRING },
                                chapterName: { type: Type.STRING }
                            },
                            required: ["questionId", "chapterId", "chapterName"]
                        }
                    }
                }
            });

            const textOutput = response.text || "[]";
            const rawAssignments = safeParseJsonWithLatex(textOutput) || [];
            
            if (Array.isArray(rawAssignments)) {
                const chapterMapById = new Map<string, typeof chapters[0]>();
                const chapterMapByName = new Map<string, typeof chapters[0]>();
                chapters.forEach(c => {
                    chapterMapById.set(c.id, c);
                    chapterMapByName.set(c.name.trim().toLowerCase(), c);
                });

                rawAssignments.forEach(item => {
                    const qId = String(item.questionId || '').trim();
                    let targetChapter = chapterMapById.get(item.chapterId);
                    if (!targetChapter && item.chapterName) {
                        targetChapter = chapterMapByName.get(String(item.chapterName).trim().toLowerCase());
                    }
                    results.push({
                        questionId: qId,
                        chapterId: targetChapter ? targetChapter.id : item.chapterId,
                        chapterName: targetChapter ? targetChapter.name : (item.chapterName || '')
                    });
                });
            }
        } catch (err: any) {
            console.warn("AI fallback error during chapter classify, using best-effort matches:", err);
            // Nếu AI gặp lỗi, gắn vào chương đầu tiên phù hợp
            questionsNeedingAi.forEach(q => {
                results.push({
                    questionId: q.id,
                    chapterId: chapters[0].id,
                    chapterName: chapters[0].name
                });
            });
        }

        return results;
    };

    export interface QuestionLevelAssignment {
        questionId: string;
        level: QuestionLevel;
        subQuestionLevels?: {
            index: number;
            level: QuestionLevel;
        }[];
    }

    /**
     * Nhận diện nhanh mức độ nhận thức CHỈ KHI có thẻ tag rõ ràng do giáo viên/nguồn đề ghi trong văn bản:
     * [NB], [TH], [VD], [VDC], [B], [H], [Nhận biết], [Thông hiểu], [Vận dụng], [Vận dụng cao]
     */
    const detectLevelFast = (q: Question): { level?: QuestionLevel; subLevels?: { index: number; level: QuestionLevel }[] } | null => {
        // 1. Đối với câu hỏi Đúng/Sai (Group-TF):
        // Chỉ chấp nhận nhận diện nhanh nếu TẤT CẢ các ý con đều có tag mức độ tường minh trong văn bản.
        // Nếu bất kỳ ý nào chưa có tag, BẮT BUỘC chuyển cho AI đọc và phân tích chiều sâu.
        if (q.type === 'group-tf' && q.subQuestions && q.subQuestions.length > 0) {
            const subLvs: { index: number; level: QuestionLevel }[] = [];
            let allSubHaveExplicitTag = true;

            q.subQuestions.forEach((sq, idx) => {
                let sLvl: QuestionLevel | undefined = undefined;
                if (sq.level) {
                    sLvl = normalizeLevel(sq.level);
                }
                if (!sLvl && sq.text) {
                    const match = sq.text.match(/(?:\[|\(|\<|\{)\s*(NB|B|TH|H|VD|VDC|Nhận\s*biết|Thông\s*hiểu|Vận\s*dụng\s*cao|Vận\s*dụng|Biết|Hiểu)\s*(?:\]|\)|\>|\})/i);
                    if (match) {
                        sLvl = normalizeLevel(match[1]);
                    }
                }

                if (sLvl) {
                    subLvs.push({ index: idx, level: sLvl });
                } else {
                    allSubHaveExplicitTag = false;
                }
            });

            // Nếu toàn bộ ý a, b, c, d đã có tag rõ ràng, dùng luôn kết quả tag
            if (allSubHaveExplicitTag && subLvs.length === q.subQuestions.length) {
                const mainLvl = q.level ? normalizeLevel(q.level) : (subLvs[1]?.level || subLvs[0]?.level || 'H');
                return {
                    level: mainLvl,
                    subLevels: subLvs
                };
            }

            // Nếu chưa đủ tag rõ ràng cho từng ý -> trả về null để AI đọc và phân tích từng ý
            return null;
        }

        // 2. Đối với câu hỏi trắc nghiệm đơn hoặc trả lời ngắn:
        let detectedLevel: QuestionLevel | undefined = undefined;
        if (q.level) {
            detectedLevel = normalizeLevel(q.level);
        }

        if (!detectedLevel) {
            const combinedText = `${q.text || ''} ${q.solution || ''}`;
            const matchTag = combinedText.match(/(?:\[|\(|\<|\{)\s*(NB|B|TH|H|VD|VDC|Nhận\s*biết|Thông\s*hiểu|Vận\s*dụng\s*cao|Vận\s*dụng|Biết|Hiểu)\s*(?:\]|\)|\>|\})/i);
            if (matchTag) {
                detectedLevel = normalizeLevel(matchTag[1]);
            }
            
            if (!detectedLevel) {
                const prefixMatch = combinedText.match(/(?:Mức\s*(?:độ)?|Cấp\s*độ)\s*:\s*(Nhận\s*biết|Thông\s*hiểu|Vận\s*dụng\s*cao|Vận\s*dụng|NB|TH|VD|VDC|B|H)/i);
                if (prefixMatch) {
                    detectedLevel = normalizeLevel(prefixMatch[1]);
                }
            }
        }

        if (detectedLevel) {
            return { level: detectedLevel };
        }

        return null;
    };

    /**
     * Dùng AI Gemini đọc sâu nội dung từng câu hỏi và từng mệnh đề a, b, c, d
     * để phân tích mức độ nhận thức (B: Nhận biết, H: Thông hiểu, VD: Vận dụng, VDC: Vận dụng cao) chuẩn xác.
     */
    export const classifyQuestionsIntoLevels = async (
        questions: Question[],
        options?: {
            subject?: string;
            grade?: string;
            customApiKey?: string;
        }
    ): Promise<QuestionLevelAssignment[]> => {
        if (!questions || questions.length === 0) return [];

        const results: QuestionLevelAssignment[] = [];
        const questionsNeedingAi: Question[] = [];

        // BƯỚC 1: Quét nhanh các câu đã có sẵn thẻ Tag rõ ràng ([NB], [TH], [VD], [VDC])
        questions.forEach(q => {
            const fastMatch = detectLevelFast(q);
            if (fastMatch && fastMatch.level) {
                results.push({
                    questionId: q.id,
                    level: fastMatch.level,
                    subQuestionLevels: fastMatch.subLevels
                });
            } else {
                questionsNeedingAi.push(q);
            }
        });

        // Nếu tất cả đã có sẵn tag từ trước thì trả về ngay
        if (questionsNeedingAi.length === 0) {
            return results;
        }

        // BƯỚC 2: Gửi cho AI Gemini đọc và phân tích chi tiết
        const ai = getAiClient(options?.customApiKey);

        // Chia theo từng nhóm (batch) tối đa 15 câu để AI đọc kỹ và không bị quá tải token
        const BATCH_SIZE = 15;
        for (let i = 0; i < questionsNeedingAi.length; i += BATCH_SIZE) {
            const batch = questionsNeedingAi.slice(i, i + BATCH_SIZE);

            const questionsDetailedText = batch.map((q, idx) => {
                let textBlock = `=== CÂU ${i + idx + 1} [ID: "${q.id}"] ===\nDạng câu: ${q.type}\nĐề bài: ${q.text || ''}`;
                
                if (q.type === 'group-tf' && q.subQuestions && q.subQuestions.length > 0) {
                    textBlock += '\nCác mệnh đề con (cần phân tích độ khó từng ý):';
                    q.subQuestions.forEach((sq, sIdx) => {
                        const letter = String.fromCharCode(97 + sIdx); // a, b, c, d
                        textBlock += `\n  - Ý ${letter}) [ID_SUB: ${sIdx}]: ${sq.text || ''}`;
                    });
                } else if (q.options && q.options.length > 0) {
                    textBlock += `\nCác phương án: ${q.options.map((opt, oIdx) => `${String.fromCharCode(65 + oIdx)}. ${opt}`).join(' | ')}`;
                }

                if (q.solution) {
                    textBlock += `\nLời giải / Hướng dẫn: ${q.solution.substring(0, 300)}`;
                }

                return textBlock;
            }).join('\n\n');

            const prompt = `Bạn là chuyên gia thẩm định ma trận đề thi và khảo thí THPT Quốc gia môn ${options?.subject || 'Toán'} lớp ${options?.grade || '12'}.
Nhiệm vụ: Đọc kỹ đề bài, các ý hỏi và lời giải của ${batch.length} câu hỏi dưới đây để phân tích tư duy và đánh giá chính xác mức độ nhận thức:

THANG ĐO 4 MỨC ĐỘ NHẬN THỨC CHUẨN:
- "B" (Biết / Nhận biết): Nhận diện khái niệm, công thức, định lý trực tiếp, đọc đồ thị/bảng số liệu trực quan 1 bước đơn giản.
- "H" (Hiểu / Thông hiểu): Áp dụng công thức, giải phương trình/bất phương trình cơ bản, biến đổi suy luận 2-3 bước, hiểu bản chất định luật.
- "VD" (Vận dụng): Phối hợp nhiều kiến thức, biến đổi tính toán tổng hợp, giải quyết bài toán thực tế mức độ trung bình khá.
- "VDC" (Vận dụng cao): Bài toán cực trị/tham số khó, phân loại học sinh giỏi (mục tiêu 9-10 điểm), đòi hỏi kỹ thuật giải đặc biệt, biến đổi nhiều bước phức tạp.

QUY TẮC ĐẶC BIỆT CHO CÂU HỎI ĐÚNG/SAI ("group-tf"):
1. Đọc và phân tích ĐỘC LẬP từng mệnh đề a, b, c, d theo đúng độ phức tạp và lượng phép tính của từng ý.
2. TUYỆT ĐỐI KHÔNG gán rập khuôn máy móc theo thứ tự a=B, b=H, c=VD, d=VDC. Phân bố mức độ thực tế tùy thuộc hoàn toàn vào nội dung từng ý (ví dụ: a:B, b:B, c:H, d:VD hoặc a:H, b:H, c:VD, d:VDC hoặc a:B, b:H, c:H, d:VD, v.v.).
3. Trả về mảng "subQuestionLevels" với "index" tương ứng 0 (ý a), 1 (ý b), 2 (ý c), 3 (ý d) và "level" tương ứng ("B", "H", "VD", "VDC").
4. Mức độ chung "level" của câu là mức độ chủ đạo của bài toán.

DANH SÁCH CÂU HỎI:
${questionsDetailedText}

Hãy trả về JSON Array:
[
  {
    "questionId": "ID_câu",
    "level": "B" | "H" | "VD" | "VDC",
    "subQuestionLevels": [
      { "index": 0, "level": "B" | "H" | "VD" | "VDC" },
      { "index": 1, "level": "B" | "H" | "VD" | "VDC" },
      { "index": 2, "level": "B" | "H" | "VD" | "VDC" },
      { "index": 3, "level": "B" | "H" | "VD" | "VDC" }
    ]
  }
]`;

            try {
                const response = await callGeminiWithRetryAndFallback(ai, {
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    questionId: { type: Type.STRING },
                                    level: { 
                                        type: Type.STRING,
                                        enum: ["B", "H", "VD", "VDC"]
                                    },
                                    subQuestionLevels: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                index: { type: Type.INTEGER },
                                                level: {
                                                    type: Type.STRING,
                                                    enum: ["B", "H", "VD", "VDC"]
                                                }
                                            },
                                            required: ["index", "level"]
                                        }
                                    }
                                },
                                required: ["questionId", "level"]
                            }
                        }
                    }
                });

                const textOutput = response.text || "[]";
                const rawAssignments = safeParseJsonWithLatex(textOutput) || [];

                if (Array.isArray(rawAssignments)) {
                    rawAssignments.forEach(item => {
                        const qId = String(item.questionId || '').trim();
                        const normalizedLvl = normalizeLevel(item.level) || 'H';
                        const subLvls = Array.isArray(item.subQuestionLevels) 
                            ? item.subQuestionLevels.map((sq: any) => ({
                                index: Number(sq.index) || 0,
                                level: normalizeLevel(sq.level) || 'H'
                            }))
                            : undefined;

                        results.push({
                            questionId: qId,
                            level: normalizedLvl,
                            subQuestionLevels: subLvls
                        });
                    });
                }
            } catch (err: any) {
                console.warn("AI error during batch level classify:", err);
                batch.forEach(q => {
                    results.push({
                        questionId: q.id,
                        level: q.type === 'short' ? 'VD' : 'H'
                    });
                });
            }
        }

        return results;
    };


