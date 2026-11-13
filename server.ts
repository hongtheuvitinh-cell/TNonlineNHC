import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load local .env / .env.local if running locally outside AI Studio Secrets
const loadLocalEnvFiles = () => {
  const proc = process as unknown as { loadEnvFile?: (filePath?: string) => void };
  if (typeof proc.loadEnvFile !== 'function') return;
  for (const envFile of ['.env.local', '.env']) {
    const fullPath = path.join(__dirname, envFile);
    if (fs.existsSync(fullPath)) {
      try {
        proc.loadEnvFile(fullPath);
      } catch {
        // Ignore malformed optional env files
      }
    }
  }
};
loadLocalEnvFiles();

const CANDIDATE_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
const FAST_CLASSIFY_MODELS = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

const getGeminiApiKey = (): string => {
  const raw = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  return raw.trim();
};

const getAiClient = (): GoogleGenAI => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'Chưa cấu hình GEMINI_API_KEY trên máy chủ. Vui lòng kiểm tra biến GEMINI_API_KEY trong Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

const formatGeminiError = (error: unknown): string => {
  const errObj = error as { message?: string };
  const errorStr =
    errObj?.message ||
    (typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error));

  if (
    errorStr.includes('404') ||
    errorStr.includes('NOT_FOUND') ||
    errorStr.includes('not found') ||
    errorStr.includes('is not found for API version') ||
    errorStr.includes('no longer available')
  ) {
    return "Lỗi 404 (Không tìm thấy Model): Mô hình AI không khả dụng. Hệ thống đã tự động thử các mô hình dự phòng, vui lòng bấm thử lại.";
  }
  if (
    errorStr.includes('503') ||
    errorStr.includes('UNAVAILABLE') ||
    errorStr.includes('high demand') ||
    errorStr.includes('overloaded') ||
    errorStr.includes('temporary')
  ) {
    return "Máy chủ AI của Google đang chịu tải cao tạm thời (Lỗi 503 - High Demand). Hệ thống đã tự động thử các kênh dự phòng, vui lòng thử lại sau vài giây.";
  }
  if (
    errorStr.includes('403') ||
    errorStr.includes('PERMISSION_DENIED') ||
    errorStr.includes('permission')
  ) {
    return "Lỗi 403 (Không có quyền truy cập): Vui lòng kiểm tra lại GEMINI_API_KEY trong phần Settings > Secrets.";
  }
  if (
    errorStr.includes('429') ||
    errorStr.includes('RESOURCE_EXHAUSTED') ||
    errorStr.includes('quota')
  ) {
    return "Lỗi 429 (Vượt quá hạn mức): Tốc độ gọi AI bị giới hạn tạm thời. Vui lòng đợi khoảng 5-10 giây rồi bấm thử lại.";
  }
  if (
    errorStr.includes('API_KEY_INVALID') ||
    errorStr.includes('API key not valid') ||
    errorStr.includes('400')
  ) {
    return "Lỗi 400: Yêu cầu hoặc GEMINI_API_KEY không hợp lệ. Vui lòng kiểm tra lại cấu hình trong Settings > Secrets.";
  }
  return errorStr;
};

const callGeminiWithRetryAndFallback = async (
  ai: GoogleGenAI,
  params: {
    contents: unknown;
    config?: Record<string, unknown>;
  },
  preferredModels: string[] = CANDIDATE_MODELS,
  options?: { lowLatencyOnHydrogen?: boolean }
) => {
  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < preferredModels.length; mIdx++) {
    const model = preferredModels[mIdx];
    const maxRetries = 2;

    const effectiveConfig =
      options?.lowLatencyOnHydrogen && model === 'gemini-4-hydrogen'
        ? { ...(params.config || {}), thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : params.config;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents as never,
          config: effectiveConfig as never,
        });
        return response;
      } catch (err: unknown) {
        lastError = err;
        const errObj = err as { message?: string };
        const errStr =
          errObj?.message ||
          (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err));

        const isNotFoundOrDeprecated =
          errStr.includes('404') ||
          errStr.includes('NOT_FOUND') ||
          errStr.includes('not found') ||
          errStr.includes('no longer available') ||
          errStr.includes('is not found for API version');

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

        if (isNotFoundOrDeprecated && mIdx < preferredModels.length - 1) {
          console.log(`[Gemini API] Model ${model} không khả dụng (404), chuyển sang: ${preferredModels[mIdx + 1]}`);
          break;
        }

        if (
          errStr.includes('API_KEY_INVALID') ||
          errStr.includes('API key not valid') ||
          (errStr.includes('403') && !errStr.includes('503'))
        ) {
          throw err;
        }

        if (isOverloadedOrUnavailable && attempt < maxRetries) {
          const delayMs = (attempt + 1) * 1200;
          await new Promise((res) => setTimeout(res, delayMs));
          continue;
        }

        if (isOverloadedOrUnavailable && mIdx < preferredModels.length - 1) {
          console.log(`[Gemini API] Chuyển sang model dự phòng: ${preferredModels[mIdx + 1]}`);
          break;
        }

        throw err;
      }
    }
  }

  throw lastError;
};

const buildExtractionInstruction = (withSolution: boolean = true) => `Bạn là chuyên gia khảo thí và giáo viên sư phạm hàng đầu THPT quốc gia Việt Nam (Toán, Vật lí, Hóa học, Sinh học, Tin học, Ngữ văn, Lịch sử, Địa lí, GDCD, Tiếng Anh).

    NHIỆM VỤ:
    1. Trích xuất đầy đủ, trung thực và chính xác toàn bộ câu hỏi, phương án, mức độ nhận biết và ĐIỀN ĐÁP ÁN ĐÚNG ('correctAnswer') từ tài liệu được cung cấp (file PDF hoặc đoạn văn bản).
    ${withSolution ? `2. TẠO LỜI GIẢI GỌN GÀNG, SÚC TÍCH 100% CHO TẤT CẢ CÁC CÂU HỎI (BẮT BUỘC): Điền đầy đủ vào trường 'solution'. TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỂ TRỐNG TRƯỜNG 'solution' Ở BẤT KỲ CÂU HỎI NÀO.

    QUY TẮC VIẾT LỜI GIẢI ('solution') - NGẮN GỌN, VIẾT CÔNG THỨC RỒI BẰNG KẾT QUẢ, THEO GẠCH ĐẦU DÒNG (CỰC KỲ QUAN TRỌNG):
    - PHONG CÁCH: Trình bày đơn giản, súc tích bằng các gạch đầu dòng (- ...).
    - CÔNG THỨC & KẾT QUẢ: Viết công thức/định luật rồi ghi dấu bằng ra kết quả luôn (Dạng: [Công thức] = [Kết quả]). 
    TUYỆT ĐỐI BỎ QUA quá trình điền/thay thế số chi tiết, vụn vặt vào giữa các phép tính để tránh làm rối lời giải.
    - KHÔNG viết văn rườm rà, giải thích lòng vòng lan man.` : `2. KHÔNG TẠO LỜI GIẢI CHI TIẾT (QUAN TRỌNG): Để trường 'solution' là chuỗi rỗng "" hoặc null cho tất cả các câu hỏi. Vẫn BẮT BUỘC phải điền đáp án đúng 'correctAnswer' chính xác 100% (cho câu MCQ, GROUP-TF và SHORT) nhưng TUYỆT ĐỐI KHÔNG viết lời giải giải thích.`}

    1. MCQ (Trắc nghiệm 4 lựa chọn):
    - 'correctAnswer': BẮT BUỘC là nội dung chính xác của phương án đúng (không kèm nhãn A, B, C, D).
    ${withSolution ? `- 'solution': Trình bày bằng gạch đầu dòng:
        - Áp dụng công thức: [Công thức] = [Kết quả].
        - Chọn đáp án: [Nội dung phương án đúng].` : `- 'solution': Để chuỗi rỗng "".`}

    2. GROUP-TF (Trắc nghiệm Đúng/Sai):
    - 'subQuestions': BẮT BUỘC có đủ 4 ý (a, b, c, d). Mỗi ý gồm 'text', 'correctAnswer' ("True" hoặc "False") và 'level' ("B"|"H"|"VD"|"VDC").
    ${withSolution ? `- 'solution': BẮT BUỘC trình bày theo 4 ý a, b, c, d dạng gạch đầu dòng ngắn gọn:
        - a) Đúng. Vì [Công thức] = [Kết quả].
        - b) Sai. Vì [Công thức] = [Kết quả đúng].
        - c) Đúng. Vì [Lý do / Công thức ngắn gọn].
        - d) Sai. Vì [Lý do / Công thức ngắn gọn].` : `- 'solution': Để chuỗi rỗng "".`}

    3. SHORT (Trả lời ngắn):
    - 'type': BẮT BUỘC là "short".
    - 'correctAnswer': BẮT BUỘC là giá trị con số chính xác (VD: "12", "-3.5", "0.25").
    ${withSolution ? `- 'solution': Dùng các gạch đầu dòng ngắn gọn:
        - [Công thức/Định luật] = [Kết quả].
        - Đáp số: [Số].` : `- 'solution': Để chuỗi rỗng "".`}

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
    - MCQ: {"type": "mcq", "level": "B", "text": "Một vật dao động điều hòa...", "options": ["$10$ cm/s", "$20$ cm/s", "$30$ cm/s", "$40$ cm/s"], "correctAnswer": "$20$ cm/s", "solution": ${withSolution ? `"- Áp dụng công thức: $v_{max} = \\\\omega A = 20$ cm/s.\\\\n- Chọn đáp án: $20$ cm/s."` : `""`}}
    - GROUP-TF: {"type": "group-tf", "level": "H", "text": "Cho một vật dao động điều hòa có phương trình $x = 5\\\\cos(2\\\\pi t)$ cm...", "subQuestions": [{"text": "Biên độ dao động của vật là $5$ cm.", "correctAnswer": "True", "level": "B"}, {"text": "Tần số góc của dao động là $4\\\\pi$ rad/s.", "correctAnswer": "False", "level": "B"}, {"text": "Vận tốc cực đại của vật là $10\\\\pi$ cm/s.", "correctAnswer": "True", "level": "H"}, {"text": "Gia tốc cực đại của vật là $100\\\\pi^2$ cm/s$^2$.", "correctAnswer": "False", "level": "VD"}], "solution": ${withSolution ? `"- a) Đúng. Biên độ $A = 5$ cm.\\\\n- b) Sai. Tần số góc $\\\\omega = 2\\\\pi$ rad/s.\\\\n- c) Đúng. Vận tốc cực đại $v_{max} = \\\\omega A = 10\\\\pi$ cm/s.\\\\n- d) Sai. Gia tốc cực đại $a_{max} = \\\\omega^2 A = 20\\\\pi^2$ cm/s$^2$."` : `""`}}
    - SHORT: {"type": "short", "level": "VD", "text": "Một mạch dao động LC lí tưởng gồm cuộn cảm thuần $L = 2$ mH và tụ điện $C = 8$ pF. Chu kỳ dao động riêng của mạch là bao nhiêu microgiây (làm tròn đến 2 chữ số thập phân)?", "correctAnswer": "0.79", "solution": ${withSolution ? `"- Chu kỳ dao động: $T = 2\\\\pi\\\\sqrt{LC} = 2,51 \\\\cdot 10^{-6}$ s = $2,51$ $\\\\mu$s.\\\\n- Đáp số: $0.79$."` : `""`}}
    `;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/gemini/status', (_req, res) => {
    res.json({ ready: Boolean(getGeminiApiKey()) });
  });

  app.post('/api/gemini/generate-quiz', async (req, res) => {
    try {
      const ai = getAiClient();
      const config = req.body || {};

      let matrixPrompt = '';
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
        ? 'NGUỒN DỮ LIỆU: Hãy đọc kỹ file PDF được cung cấp. BẮT BUỘC chỉ được lấy dữ liệu, ý tưởng hoặc trích xuất trực tiếp các câu hỏi từ nội dung trong file PDF này để soạn đề. Không được tự ý chế tác nội dung nằm ngoài phạm vi tài liệu PDF trừ khi cần thiết để hoàn thiện cấu trúc câu hỏi.'
        : 'NGUỒN DỮ LIỆU: Sử dụng kho tri thức chuyên sâu của bạn về chương trình giáo dục phổ thông Việt Nam để soạn đề.';

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

      const contents = config.pdfBase64
        ? {
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: config.pdfBase64 } },
              { text: prompt },
            ],
          }
        : prompt;

      const response = await callGeminiWithRetryAndFallback(ai, {
        contents,
        config: {
          responseMimeType: 'application/json',
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
                      level: { type: Type.STRING, nullable: true },
                    },
                    required: ['text', 'correctAnswer'],
                  },
                },
              },
              required: ['type', 'text', 'points', 'solution'],
            },
          },
        },
      });

      res.json({ text: response.text || '[]' });
    } catch (error: unknown) {
      res.status(500).json({ error: 'AI không thể tạo đề: ' + formatGeminiError(error) });
    }
  });

  app.post('/api/gemini/generate-matrix-chunk', async (req, res) => {
    try {
      const ai = getAiClient();
      const { subject, grade, topic, promptAdditions, pdfBase64, chunkReqs } = req.body || {};
      const reqList = Array.isArray(chunkReqs) ? chunkReqs : [];
      const chunkTotal = reqList.reduce((sum: number, r: { count?: number }) => sum + (Number(r.count) || 0), 0);

      const reqDescription = reqList
        .map(
          (r: { chapterName: string; type: string; level: string; count: number }, idx: number) => {
            const typeStr =
              r.type === 'mcq'
                ? 'Trắc nghiệm nhiều lựa chọn 4 phương án (type: "mcq")'
                : r.type === 'group-tf'
                ? 'Trắc nghiệm Đúng/Sai gồm đúng 4 ý a, b, c, d (type: "group-tf")'
                : 'Trả lời ngắn điền số/kết quả (type: "short")';
            const levelStr =
              r.level === 'B'
                ? 'Nhận biết (level: "B")'
                : r.level === 'H'
                ? 'Thông hiểu (level: "H")'
                : r.level === 'VD'
                ? 'Vận dụng (level: "VD")'
                : 'Vận dụng cao (level: "VDC")';
            return `  ${idx + 1}. Chương: "${r.chapterName}" | Loại: ${typeStr} | Mức độ: ${levelStr} -> BẮT BUỘC TẠO CHÍNH XÁC ${r.count} CÂU HỎI.`;
          }
        )
        .join('\n');

      const sourceInstruction = pdfBase64
        ? 'NGUỒN TÀI LIỆU PDF: Bạn được cung cấp tệp PDF. Hãy bóc tách hoặc sáng tạo câu hỏi bám sát tài liệu này. Nếu tài liệu không đủ các câu ở mức độ yêu cầu, hãy tự động soạn câu hỏi tương ứng với nội dung kiến thức trong tài liệu theo đúng mức độ.'
        : 'NGUỒN KIẾN THỨC: Bám sát khung chương trình giáo dục phổ thông mới (GDPT 2018) của Bộ GD&ĐT Việt Nam.';

      const prompt = `Bạn là chuyên gia khảo thí và ra đề thi chuẩn GDPT 2018 của Bộ Giáo dục & Đào tạo Việt Nam.
    ${sourceInstruction}

    THÔNG TIN ĐỀ THI:
    - Môn học: ${subject || 'Vật lí'}
    - Khối lớp: ${grade}
    - Tiêu đề / Chủ đề: ${topic || `Đề thi kiểm tra môn ${subject || 'Vật lí'} Khối ${grade}`}
    ${promptAdditions ? `\n- YÊU CẦU ĐẶC BIỆT CỦA GIÁO VIÊN:\n"""\n${promptAdditions}\n"""` : ''}

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

      const contents = pdfBase64
        ? {
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
              { text: prompt },
            ],
          }
        : prompt;

      const response = await callGeminiWithRetryAndFallback(ai, {
        contents,
        config: {
          responseMimeType: 'application/json',
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
                      level: { type: Type.STRING, nullable: true },
                    },
                    required: ['text', 'correctAnswer'],
                  },
                },
              },
              required: ['type', 'text', 'solution'],
            },
          },
        },
      });

      res.json({ text: response.text || '[]' });
    } catch (error: unknown) {
      res.status(500).json({ error: `AI không thể tạo câu hỏi theo ma trận: ${formatGeminiError(error)}` });
    }
  });

  app.post('/api/gemini/parse-pdf', async (req, res) => {
    try {
      const ai = getAiClient();
      const { base64Data, withSolution = true } = req.body || {};
      const instruction = buildExtractionInstruction(Boolean(withSolution));

      const response = await callGeminiWithRetryAndFallback(ai, {
        contents: {
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64Data } },
            { text: instruction },
          ],
        },
        config: {
          responseMimeType: 'application/json',
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
                solution: { type: Type.STRING, nullable: true },
                subQuestions: {
                  type: Type.ARRAY,
                  nullable: true,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      correctAnswer: { type: Type.STRING },
                      level: { type: Type.STRING, nullable: true },
                    },
                    required: ['text', 'correctAnswer'],
                  },
                },
              },
              required: ['type', 'text'],
            },
          },
        },
      });

      res.json({ text: response.text || '[]' });
    } catch (error: unknown) {
      res.status(500).json({ error: 'Lỗi đọc PDF: ' + formatGeminiError(error) });
    }
  });

  app.post('/api/gemini/parse-text', async (req, res) => {
    try {
      const ai = getAiClient();
      const { rawText, withSolution = true } = req.body || {};
      const instruction = buildExtractionInstruction(Boolean(withSolution));

      const response = await callGeminiWithRetryAndFallback(ai, {
        contents: `${instruction}\n\nNỘI DUNG VĂN BẢN CẦN TRÍCH XUẤT:\n${rawText || ''}`,
        config: {
          responseMimeType: 'application/json',
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
                solution: { type: Type.STRING, nullable: true },
                subQuestions: {
                  type: Type.ARRAY,
                  nullable: true,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      correctAnswer: { type: Type.STRING },
                    },
                    required: ['text', 'correctAnswer'],
                  },
                },
              },
              required: ['type', 'text'],
            },
          },
        },
      });

      res.json({ text: response.text || '[]' });
    } catch (error: unknown) {
      res.status(500).json({ error: 'Lỗi bóc tách văn bản: ' + formatGeminiError(error) });
    }
  });

  app.post('/api/gemini/solve-question', async (req, res) => {
    try {
      const ai = getAiClient();
      const { question, subject = 'Vật lí', grade = '12' } = req.body || {};

      let questionDesc = `NỘI DUNG CÂU HỎI:\n${question?.text || ''}\n`;
      if (question?.type === 'mcq' && Array.isArray(question.options)) {
        questionDesc += `CÁC PHƯƠNG ÁN:\n${question.options
          .map((opt: string, i: number) => `${String.fromCharCode(65 + i)}. ${opt}`)
          .join('\n')}\n`;
        if (question.correctAnswer) {
          questionDesc += `ĐÁP ÁN ĐÃ CHỌN: ${question.correctAnswer}\n`;
        }
      } else if (question?.type === 'group-tf' && Array.isArray(question.subQuestions)) {
        questionDesc += `CÁC Ý TRẮC NGHIỆM ĐÚNG/SAI:\n${question.subQuestions
          .map(
            (sq: { text: string; correctAnswer: string }, i: number) =>
              `${String.fromCharCode(97 + i)}) ${sq.text} (Hiện tại: ${sq.correctAnswer === 'True' ? 'Đúng' : 'Sai'})`
          )
          .join('\n')}\n`;
      } else if (question?.type === 'short' && question.correctAnswer) {
        questionDesc += `ĐÁP SỐ ĐÃ NHẬP: ${question.correctAnswer}\n`;
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

      const response = await callGeminiWithRetryAndFallback(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              solution: { type: Type.STRING },
              correctAnswer: { type: Type.STRING, nullable: true },
            },
            required: ['solution'],
          },
        },
      });

      res.json({ text: response.text || '{}' });
    } catch (error: unknown) {
      res.status(500).json({ error: 'Lỗi AI giải câu hỏi: ' + formatGeminiError(error) });
    }
  });

  app.post('/api/gemini/classify-chapters', async (req, res) => {
    try {
      const ai = getAiClient();
      const { batch, chapters, subject = 'Vật lí', grade = '12', offset = 0 } = req.body || {};

      const chaptersList = Array.isArray(chapters) ? chapters : [];
      const batchList = Array.isArray(batch) ? batch : [];

      const chaptersListText = chaptersList
        .map((c: { id: string; name: string }, idx: number) => `${idx + 1}. [MÃ_CHƯƠNG: "${c.id}"] -> Tên: "${c.name}"`)
        .join('\n');

      const detailedQuestionsText = batchList
        .map(
          (
            q: {
              id: string;
              text?: string;
              options?: string[];
              subQuestions?: { text?: string }[];
              solution?: string;
            },
            idx: number
          ) => {
            let textBlock = `=== CÂU ${Number(offset) + idx + 1} [ID: "${q.id}"] ===\nNội dung: ${q.text || ''}`;
            if (Array.isArray(q.options) && q.options.length > 0) {
              textBlock += `\nPhương án: ${q.options.join(' | ')}`;
            }
            if (Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
              textBlock += `\nCác ý Đúng/Sai: ${q.subQuestions.map((s) => s.text || '').join(' | ')}`;
            }
            if (q.solution) {
              textBlock += `\nLời giải tóm tắt: ${q.solution.substring(0, 250)}`;
            }
            return textBlock;
          }
        )
        .join('\n\n');

      const prompt = `Bạn là chuyên gia phân tích chương trình học GDPT 2018 môn ${subject} lớp ${grade}.
Nhiệm vụ: Đọc kỹ nội dung của ${batchList.length} câu hỏi dưới đây và gán từng câu vào đúng 1 chương trong danh sách chương cho sẵn.

DANH SÁCH CHƯƠNG ĐANG CÓ TRONG HỆ THỐNG:
${chaptersListText}

DANH SÁCH CÂU HỎI CẦN GÁN CHƯƠNG:
${detailedQuestionsText}

YÊU CẦU:
1. Đọc kiến thức trọng tâm của từng câu hỏi để chọn chương phù hợp nhất.
2. ĐỐI VỚI MÔN VẬT LÍ:
   - Các câu hỏi về "khối khí", "khí lí tưởng", "đẳng áp", "đẳng nhiệt", "đẳng tích", "phương trình trạng thái pV/T", "định luật Boyle/Charles", "mô hình động học phân tử chất khí", "áp suất khí", "tốc độ căn quân phương" BẮT BUỘC PHẢI THUỘC CHƯƠNG "Khí lí tưởng" (hoặc "Chất khí"), dù đề bài có chứa từ "nhiệt độ" hay "nhiệt độ tuyệt đối".
   - Các câu hỏi về "nhiệt dung riêng", "nhiệt nóng chảy riêng", "nhiệt hóa hơi riêng", "nhiệt lượng", "thang nhiệt độ", "chuyển thể (nóng chảy, bay hơi, sôi, đông đặc)", "nội năng và nguyên lí 1 NĐLH (ΔU=A+Q)" BẮT BUỘC THUỘC CHƯƠNG "Vật lí nhiệt".
3. "chapterId" PHẢI là chuỗi [MÃ_CHƯƠNG] của chương tương ứng trong danh sách trên.
4. "chapterName" là tên chính xác của chương đó.

Trả về JSON Array:
[
  {
    "questionId": "ID_của_câu",
    "chapterId": "MÃ_CHƯƠNG",
    "chapterName": "Tên_chương"
  }
]`;

      const response = await callGeminiWithRetryAndFallback(
        ai,
        {
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionId: { type: Type.STRING },
                  chapterId: { type: Type.STRING },
                  chapterName: { type: Type.STRING },
                },
                required: ['questionId', 'chapterId', 'chapterName'],
              },
            },
          },
        },
        FAST_CLASSIFY_MODELS,
        { lowLatencyOnHydrogen: true }
      );

      res.json({ text: response.text || '[]' });
    } catch (error: unknown) {
      res.status(500).json({ error: formatGeminiError(error) });
    }
  });

  app.post('/api/gemini/classify-levels', async (req, res) => {
    try {
      const ai = getAiClient();
      const { batch, subject = 'Vật lí', grade = '12', offset = 0 } = req.body || {};
      const batchList = Array.isArray(batch) ? batch : [];

      const questionsDetailedText = batchList
        .map(
          (
            q: {
              id: string;
              type: string;
              text?: string;
              options?: string[];
              subQuestions?: { text?: string }[];
              solution?: string;
            },
            idx: number
          ) => {
            let textBlock = `=== CÂU ${Number(offset) + idx + 1} [ID: "${q.id}"] ===\nDạng câu: ${q.type}\nĐề bài: ${q.text || ''}`;
            if (q.type === 'group-tf' && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
              textBlock += '\nCác mệnh đề con (cần phân tích độ khó từng ý):';
              q.subQuestions.forEach((sq, sIdx) => {
                const letter = String.fromCharCode(97 + sIdx);
                textBlock += `\n  - Ý ${letter}) [ID_SUB: ${sIdx}]: ${sq.text || ''}`;
              });
            } else if (Array.isArray(q.options) && q.options.length > 0) {
              textBlock += `\nCác phương án: ${q.options
                .map((opt, oIdx) => `${String.fromCharCode(65 + oIdx)}. ${opt}`)
                .join(' | ')}`;
            }
            if (q.solution) {
              textBlock += `\nLời giải / Hướng dẫn: ${q.solution.substring(0, 300)}`;
            }
            return textBlock;
          }
        )
        .join('\n\n');

      const prompt = `Bạn là chuyên gia thẩm định ma trận đề thi và khảo thí THPT Quốc gia môn ${subject} lớp ${grade}.
Nhiệm vụ: Đọc kỹ đề bài, các ý hỏi và lời giải của ${batchList.length} câu hỏi dưới đây để phân tích tư duy và đánh giá chính xác mức độ nhận thức:

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

      const response = await callGeminiWithRetryAndFallback(
        ai,
        {
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionId: { type: Type.STRING },
                  level: {
                    type: Type.STRING,
                    enum: ['B', 'H', 'VD', 'VDC'],
                  },
                  subQuestionLevels: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        index: { type: Type.INTEGER },
                        level: {
                          type: Type.STRING,
                          enum: ['B', 'H', 'VD', 'VDC'],
                        },
                      },
                      required: ['index', 'level'],
                    },
                  },
                },
                required: ['questionId', 'level'],
              },
            },
          },
        },
        FAST_CLASSIFY_MODELS,
        { lowLatencyOnHydrogen: true }
      );

      res.json({ text: response.text || '[]' });
    } catch (error: unknown) {
      res.status(500).json({ error: formatGeminiError(error) });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
