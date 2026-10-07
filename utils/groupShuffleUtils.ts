import { Question, Quiz } from '../types';

/**
 * Normalizes and strips dynamic header prefix from group passage text if present.
 * Example: "Dữ liệu dùng chung cho Câu 1 - Câu 2: Một ấm đun nước..." -> "Một ấm đun nước..."
 */
export function cleanGroupPassageText(passage: string): string {
  if (!passage) return '';
  return passage
    .replace(/^\[PASSAGE\]([\s\S]*?)\[\/PASSAGE\]\s*/i, '$1')
    .replace(/^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin|Sử\s+dụng\s+thông\s+tin|Đọc\s+thông\s+tin|Cho\s+thông\s+tin)(\s+sau)?\s+(dùng\s+chung\s+cho|cho)\s+(các\s+)?(câu|Câu)\s*\d+\s*([-–— đếnvà,\s]+\s*(câu|Câu)?\s*\d+)?\s*:\s*/i, '')
    .replace(/^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin)\s+dùng\s+chung\s*:\s*/i, '')
    .trim();
}

/**
 * Fisher-Yates shuffle array helper
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Groups questions that share the same non-empty normalized groupPassage so they are contiguous,
 * while preserving the relative order of questions and groups.
 */
export function groupQuestionsBySharedPassage(questions: Question[]): Question[] {
  if (!questions || questions.length <= 1) return [...(questions || [])];

  const blocks: Question[][] = [];
  const passageToBlockIndex = new Map<string, number>();

  for (const q of questions) {
    const normPassage = cleanGroupPassageText(q.groupPassage || '');
    if (normPassage) {
      const existingIdx = passageToBlockIndex.get(normPassage);
      if (existingIdx !== undefined && blocks[existingIdx][0].type === q.type) {
        blocks[existingIdx].push(q);
        continue;
      }
      passageToBlockIndex.set(normPassage, blocks.length);
    }
    blocks.push([q]);
  }

  return blocks.flat();
}

/**
 * Shuffles a list of questions preserving groups (questions sharing the same non-empty groupPassage).
 * Questions with the same groupPassage are kept together as an indivisible block.
 */
export function shuffleQuestionsPreservingGroups(questions: Question[]): Question[] {
  if (!questions || questions.length <= 1) return [...questions];

  // Group questions by shared normalized passage into indivisible blocks
  const blocks: Question[][] = [];
  const passageToBlockIndex = new Map<string, number>();

  for (const q of questions) {
    const normPassage = cleanGroupPassageText(q.groupPassage || '');
    if (normPassage) {
      const existingIdx = passageToBlockIndex.get(normPassage);
      if (existingIdx !== undefined) {
        blocks[existingIdx].push(q);
        continue;
      }
      passageToBlockIndex.set(normPassage, blocks.length);
    }
    blocks.push([q]);
  }

  // Shuffle the blocks
  const shuffledBlocks = shuffleArray(blocks);

  // Flatten the blocks
  return shuffledBlocks.flat();
}

/**
 * Checks if a question is the first in a group sharing groupPassage in the ordered question list.
 * Returns information about the question range (1-based start & end indices) and formatted header title.
 */
export function getGroupPassageHeaderInfo(questions: Question[], index: number): {
  isFirst: boolean;
  headerTitle: string;
  passageText: string;
  startNum: number;
  endNum: number;
} | null {
  const currentQ = questions[index];
  const rawPassage = (currentQ?.groupPassage || '').trim();
  const normPassage = cleanGroupPassageText(rawPassage);
  if (!normPassage) return null;

  // Check if previous question in the list has the same normalized groupPassage
  if (index > 0) {
    const prevNorm = cleanGroupPassageText(questions[index - 1]?.groupPassage || '');
    if (prevNorm === normPassage) {
      return { isFirst: false, headerTitle: '', passageText: '', startNum: 0, endNum: 0 };
    }
  }

  // Find end of group
  const startNum = index + 1; // 1-based index
  let endNum = startNum;
  while (
    endNum < questions.length &&
    cleanGroupPassageText(questions[endNum].groupPassage || '') === normPassage
  ) {
    endNum++;
  }

  const headerTitle = startNum === endNum
    ? `Dữ liệu dùng chung cho Câu ${startNum}:`
    : `Dữ liệu dùng chung cho Câu ${startNum} – Câu ${endNum}:`;

  return {
    isFirst: true,
    headerTitle,
    passageText: normPassage,
    startNum,
    endNum
  };
}

/**
 * Automatically detects embedded passages in question text and populates groupPassage if missing.
 */
export function repairQuestionPassage(q: Question): Question {
  const rawText = q.text || '';

  // 1. Check for explicit [PASSAGE]...[/PASSAGE] tag stored in text
  const tagMatch = rawText.match(/^\[PASSAGE\]([\s\S]*?)\[\/PASSAGE\]\s*([\s\S]*)$/i);
  if (tagMatch) {
    const extractedPassage = cleanGroupPassageText(tagMatch[1].trim());
    const explicitPassage = cleanGroupPassageText(q.groupPassage || '');
    const finalPassage = explicitPassage || extractedPassage;
    let remainingText = (tagMatch[2] || '').trim();
    if (finalPassage) {
      remainingText = remainingText.replace(/^(?:tiếp\s*(?:theo)?\s*(?:câu|bài)\s*\d+[\.\:\s\-\)]*)/i, '').trim();
    }
    return {
      ...q,
      groupPassage: finalPassage || undefined,
      text: remainingText || rawText
    };
  }

  if (q.groupPassage && q.groupPassage.trim()) {
    const cleanedPassage = cleanGroupPassageText(q.groupPassage);
    let cleanedStem = rawText.replace(/^(?:tiếp\s*(?:theo)?\s*(?:câu|bài)\s*\d+[\.\:\s\-\)]*)/i, '').trim();
    if (cleanedPassage && cleanedStem.startsWith(cleanedPassage)) {
      const stripped = cleanedStem.slice(cleanedPassage.length).replace(/^(?:[\r\n\s]+|(?:Câu|Bài)\s*\d+\s*[.:\-)]\s*)+/i, '').trim();
      if (stripped.length >= 3) {
        cleanedStem = stripped;
      }
    }
    return {
      ...q,
      groupPassage: cleanedPassage,
      text: cleanedStem || rawText
    };
  }

  // 2. Match inline or multiline "Sử dụng thông tin sau cho Câu 1 và Câu 2: [Đoạn văn] Câu 1. [Nội dung câu hỏi]"
  const inlineQuestionMatch = rawText.match(
    /^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin|Sử\s+dụng\s+thông\s+tin|Đọc\s+thông\s+tin|Cho\s+thông\s+tin)(\s+sau)?\s+(dùng\s+chung\s+cho|cho)\s+(các\s+)?(câu|Câu)\s*\d+[\s\S]*?:\s*([\s\S]+?)(?:[\r\n]+|(?<=[.!?])\s+)(?:Câu|Bài)\s*\d+\s*[.:\-)]\s*([\s\S]+)$/i
  );
  if (inlineQuestionMatch) {
    const extractedPassage = cleanGroupPassageText(inlineQuestionMatch[6].trim());
    const remainingText = inlineQuestionMatch[7].trim();
    if (extractedPassage && remainingText) {
      return {
        ...q,
        groupPassage: extractedPassage,
        text: remainingText
      };
    }
  }

  // 3. Match multiline "Dữ liệu dùng chung cho Câu 1 - Câu 2: [Đoạn văn]\n[Nội dung câu hỏi]"
  const headerMatch = rawText.match(
    /^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin|Sử\s+dụng\s+thông\s+tin|Đọc\s+thông\s+tin|Cho\s+thông\s+tin)(\s+sau)?\s+(dùng\s+chung\s+cho|cho)\s+(các\s+)?(câu|Câu)\s*\d+[\s\S]*?:\s*([\s\S]+?)(?:\r?\n)+\s*([\s\S]+)$/i
  );
  if (headerMatch) {
    const extractedPassage = cleanGroupPassageText(headerMatch[6].trim());
    const remainingText = headerMatch[7].replace(/^(?:Câu|Bài)\s*\d+\s*[.:\-)]\s*/i, '').trim();
    if (extractedPassage && remainingText) {
      return {
        ...q,
        groupPassage: extractedPassage,
        text: remainingText
      };
    }
  }

  return q;
}

/**
 * Repairs all questions in a quiz, linking consecutive questions that share embedded or existing group passages.
 */
export function autoRepairQuizQuestions(questions: Question[]): Question[] {
  if (!questions || questions.length === 0) return [];
  
  // First pass: repair individual embedded passages
  const repaired = questions.map(q => repairQuestionPassage(q));

  // Second pass: if question i has groupPassage and question i+1 has empty groupPassage,
  // check if original text or header indicated a question range (e.g. "Câu 1 - Câu 2")
  for (let i = 0; i < repaired.length - 1; i++) {
    const currentPassage = (repaired[i].groupPassage || '').trim();
    if (currentPassage && !repaired[i + 1].groupPassage) {
      const originalHeaderMatch = (questions[i].text || '').match(/(câu|Câu)\s*(\d+)\s*[-–— đến\s]+\s*(\d+)/i);
      if (originalHeaderMatch) {
        const startNum = parseInt(originalHeaderMatch[2], 10);
        const endNum = parseInt(originalHeaderMatch[3], 10);
        const relativeIdx = i + 1; // 0-based
        if (relativeIdx >= startNum - 1 && relativeIdx <= endNum - 1) {
          repaired[i + 1] = {
            ...repaired[i + 1],
            groupPassage: currentPassage
          };
        }
      }
    }
  }

  return repaired;
}

export interface ExamVariant {
  examCode: string;
  quiz: Quiz;
}

export interface GenerateVariantsOptions {
  examCodes: string[];
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  keepFirstVersionOriginal?: boolean;
}

/**
 * Generates multiple shuffled exam variants (Mã đề) for paper testing.
 * Preserves question sections (mcq, group-tf, short) and shared passage groups.
 */
export function generateShuffledExamVariants(
  baseQuiz: Quiz,
  options: GenerateVariantsOptions
): ExamVariant[] {
  const {
    examCodes,
    shuffleQuestions = true,
    shuffleOptions = true,
    keepFirstVersionOriginal = false
  } = options;

  const rawQuestions = autoRepairQuizQuestions(
    Array.isArray(baseQuiz.questions) ? baseQuiz.questions : []
  );

  const mcqBase = rawQuestions.filter(q => q.type === 'mcq');
  const groupTfBase = rawQuestions.filter(q => q.type === 'group-tf');
  const shortBase = rawQuestions.filter(q => q.type === 'short');

  const shuffleSingleSection = (sectionQs: Question[], doShuffleQ: boolean, doShuffleOpt: boolean): Question[] => {
    // Deep clone questions first
    const cloned: Question[] = sectionQs.map(q => ({
      ...q,
      options: q.options ? [...q.options] : undefined,
      subQuestions: q.subQuestions ? q.subQuestions.map(sq => ({ ...sq })) : undefined
    }));

    // 1. Shuffle question order (preserving shared passage groups and shuffling within each group)
    let orderedQs = cloned;
    if (doShuffleQ && cloned.length > 1) {
      const blocks: Question[][] = [];
      const passageToBlockIndex = new Map<string, number>();

      for (const q of cloned) {
        const normPassage = cleanGroupPassageText(q.groupPassage || '');
        if (normPassage) {
          const existingIdx = passageToBlockIndex.get(normPassage);
          if (existingIdx !== undefined) {
            blocks[existingIdx].push(q);
            continue;
          }
          passageToBlockIndex.set(normPassage, blocks.length);
        }
        blocks.push([q]);
      }

      // Shuffle questions inside multi-question shared-passage blocks as well
      const internallyShuffledBlocks = blocks.map(block =>
        block.length > 1 ? shuffleArray(block) : block
      );
      orderedQs = shuffleArray(internallyShuffledBlocks).flat();
    }

    // 2. Shuffle MCQ options if enabled
    if (doShuffleOpt) {
      orderedQs = orderedQs.map(q => {
        if (q.type === 'mcq' && q.options && q.options.length > 1) {
          const newOpts = shuffleArray(q.options);
          return {
            ...q,
            options: newOpts
          };
        }
        return q;
      });
    }

    return orderedQs;
  };

  return examCodes.map((code, index) => {
    const isOriginal = keepFirstVersionOriginal && index === 0;
    const doQ = !isOriginal && shuffleQuestions;
    const doOpt = !isOriginal && shuffleOptions;

    const mcqVariant = shuffleSingleSection(mcqBase, doQ, doOpt);
    const groupTfVariant = shuffleSingleSection(groupTfBase, doQ, false);
    const shortVariant = shuffleSingleSection(shortBase, doQ, false);

    return {
      examCode: code,
      quiz: {
        ...baseQuiz,
        questions: [...mcqVariant, ...groupTfVariant, ...shortVariant]
      }
    };
  });
}

