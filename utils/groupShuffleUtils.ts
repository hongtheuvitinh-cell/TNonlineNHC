import { Question } from '../types';

/**
 * Normalizes and strips dynamic header prefix from group passage text if present.
 * Example: "Dữ liệu dùng chung cho Câu 1 - Câu 2: Một ấm đun nước..." -> "Một ấm đun nước..."
 */
export function cleanGroupPassageText(passage: string): string {
  if (!passage) return '';
  return passage
    .replace(/^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin)\s+dùng\s+chung\s+cho\s+(câu|Câu)\s*\d+\s*[-–— đến\s]+\d+\s*:\s*/i, '')
    .replace(/^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin)\s+dùng\s+chung\s+cho\s+(câu|Câu)\s*\d+\s*:\s*/i, '')
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
 * Shuffles a list of questions preserving groups (questions sharing the same non-empty groupPassage).
 * Consecutive questions with the exact same groupPassage are kept together as an indivisible block.
 */
export function shuffleQuestionsPreservingGroups(questions: Question[]): Question[] {
  if (!questions || questions.length <= 1) return [...questions];

  // Group questions into blocks
  const blocks: Question[][] = [];
  for (const q of questions) {
    const rawPassage = (q.groupPassage || '').trim();
    if (rawPassage && blocks.length > 0) {
      const lastBlock = blocks[blocks.length - 1];
      const lastPassage = (lastBlock[0].groupPassage || '').trim();
      if (lastPassage && lastPassage === rawPassage) {
        lastBlock.push(q);
        continue;
      }
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
  if (!rawPassage) return null;

  // Check if previous question in the list has the exact same groupPassage
  if (index > 0) {
    const prevPassage = (questions[index - 1]?.groupPassage || '').trim();
    if (prevPassage === rawPassage) {
      return { isFirst: false, headerTitle: '', passageText: '', startNum: 0, endNum: 0 };
    }
  }

  // Find end of group
  const startNum = index + 1; // 1-based index
  let endNum = startNum;
  while (endNum < questions.length && (questions[endNum].groupPassage || '').trim() === rawPassage) {
    endNum++;
  }

  const cleanedPassage = cleanGroupPassageText(rawPassage);
  const headerTitle = startNum === endNum
    ? `Dữ liệu dùng chung cho Câu ${startNum}:`
    : `Dữ liệu dùng chung cho Câu ${startNum} – Câu ${endNum}:`;

  return {
    isFirst: true,
    headerTitle,
    passageText: cleanedPassage,
    startNum,
    endNum
  };
}

/**
 * Automatically detects embedded passages in question text and populates groupPassage if missing.
 */
export function repairQuestionPassage(q: Question): Question {
  if (q.groupPassage && q.groupPassage.trim()) {
    return q;
  }

  const text = q.text || '';
  // Match patterns like "Dữ liệu dùng chung cho Câu 1 - Câu 2: [Đoạn văn]\n[Nội dung câu hỏi]"
  const headerMatch = text.match(/^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin|Sử\s+dụng\s+thông\s+tin)\s+(dùng\s+chung\s+cho|cho)\s+(câu|Câu)\s*\d+[\s\S]*?:\s*([\s\S]+?)(?:\n\n|\r\n\r\n|\n[A-Z0-9ĐÁÂÊÔƯa-z0-9áàảãạâấầẩẫậăắằẳẵặc-z]|\nCâu|\n\n)([\s\S]+)$/i);
  
  if (headerMatch) {
    const extractedPassage = headerMatch[4].trim();
    const remainingText = headerMatch[5].trim();
    if (extractedPassage && remainingText) {
      return {
        ...q,
        groupPassage: cleanGroupPassageText(extractedPassage),
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
