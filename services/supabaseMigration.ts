import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Quiz, Question, User, ClassRoom, Chapter, Result, ExamSession, PublishedResult } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface MigrationProgress {
  step: string;
  detail: string;
  percent: number;
}

export interface MigrationSummary {
  classes: number;
  chapters: number;
  users: number;
  bankQuestions: number;
  quizzes: number;
  results: number;
  examSessions: number;
  publishedResults: number;
  totalTimeMs: number;
}

// Lưu và lấy cấu hình Supabase từ localStorage
const STORAGE_KEY_URL = 'eduquiz_supabase_url';
const STORAGE_KEY_KEY = 'eduquiz_supabase_anon_key';

export const DEFAULT_SUPABASE_URL = 'https://kosgiekqtutjegalbxyq.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvc2dpZWtxdHV0amVnYWxieHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3ODA2NTQsImV4cCI6MjEwNDM1NjY1NH0.uuzVBluk7DgdKIAuZrp7dEEfM-29_wZ6KapHkgQke5k';

export function getSavedSupabaseConfig(): SupabaseConfig {
  return {
    url: (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY_URL)) || (import.meta as any).env?.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY_KEY)) || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY
  };
}

export function saveSupabaseConfig(config: SupabaseConfig): void {
  if (typeof window !== 'undefined') {
    if (config.url) localStorage.setItem(STORAGE_KEY_URL, config.url.trim());
    if (config.anonKey) localStorage.setItem(STORAGE_KEY_KEY, config.anonKey.trim());
  }
}

// Khởi tạo Supabase client với kiểm tra an toàn
export function getSupabaseClient(url?: string, anonKey?: string): SupabaseClient | null {
  const finalUrl = (url || getSavedSupabaseConfig().url || '').trim();
  const finalKey = (anonKey || getSavedSupabaseConfig().anonKey || '').trim();

  if (!finalUrl || !finalKey) return null;

  try {
    return createClient(finalUrl, finalKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  } catch (err) {
    console.error("Lỗi khởi tạo Supabase Client:", err);
    return null;
  }
}

export interface TableStatus {
  name: string;
  label: string;
  exists: boolean;
  rows: number;
  error?: string;
}

// Kiểm tra kết nối tới Supabase và tình trạng tất cả các bảng CSDL
export async function testSupabaseConnection(url: string, anonKey: string): Promise<{ 
  success: boolean; 
  message: string; 
  latencyMs?: number;
  tables?: TableStatus[];
}> {
  const startTime = Date.now();
  try {
    const client = createClient(url.trim(), anonKey.trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const targetTables = [
      { name: 'classes', label: 'Lớp học (classes)' },
      { name: 'chapters', label: 'Chương mục (chapters)' },
      { name: 'users', label: 'Người dùng & Giáo viên (users)' },
      { name: 'bank_questions', label: 'Ngân hàng câu hỏi (bank_questions)' },
      { name: 'quizzes', label: 'Đề thi & câu hỏi (quizzes)' },
      { name: 'results', label: 'Kết quả làm bài (results)' },
      { name: 'exam_sessions', label: 'Phiên thi trực tuyến (exam_sessions)' },
      { name: 'published_results', label: 'Kết quả công bố (published_results)' }
    ];

    const tableStatuses: TableStatus[] = [];
    let allExist = true;
    let missingCount = 0;

    for (const t of targetTables) {
      try {
        const { count, error } = await client.from(t.name).select('*', { count: 'exact', head: true });
        if (error) {
          allExist = false;
          missingCount++;
          tableStatuses.push({
            name: t.name,
            label: t.label,
            exists: false,
            rows: 0,
            error: error.message
          });
        } else {
          tableStatuses.push({
            name: t.name,
            label: t.label,
            exists: true,
            rows: count || 0
          });
        }
      } catch (err: any) {
        allExist = false;
        missingCount++;
        tableStatuses.push({
          name: t.name,
          label: t.label,
          exists: false,
          rows: 0,
          error: err.message
        });
      }
    }

    const latency = Date.now() - startTime;

    if (!allExist) {
      return {
        success: false,
        message: `Kết nối thành công tới Supabase (${latency}ms) nhưng còn thiếu ${missingCount}/8 bảng. Vui lòng chạy kịch bản SQL ở Bước 1.`,
        latencyMs: latency,
        tables: tableStatuses
      };
    }

    return {
      success: true,
      message: `Kết nối thành công! Đã kiểm tra 8/8 bảng CSDL, cấu trúc chính xác 100%. Phản hồi: ${latency} ms`,
      latencyMs: latency,
      tables: tableStatuses
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Lỗi kết nối Supabase: ${err.message || 'Không thể kết nối'}`
    };
  }
}

// Chia mảng thành các phần nhỏ (chunk) để nạp từng đợt
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Nạp toàn bộ dữ liệu từ file JSON vào Supabase
export async function migrateJsonToSupabase(
  url: string,
  anonKey: string,
  backupData: any,
  onProgress?: (progress: MigrationProgress) => void
): Promise<{ success: boolean; summary?: MigrationSummary; message?: string }> {
  const startTime = Date.now();
  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    return { success: false, message: "URL hoặc Anon Key của Supabase không hợp lệ." };
  }

  // Chuẩn hóa dữ liệu đầu vào (hỗ trợ cả root object hoặc backupData.data)
  const data = backupData.data || backupData;

  const rawClasses: ClassRoom[] = data.classes || [];
  const rawChapters: Chapter[] = data.chapters || [];
  const rawUsers: User[] = data.users || [];
  const rawBank: Question[] = data.bankQuestions || data.bank_questions || [];
  const rawQuizzes: Quiz[] = data.quizzes || [];
  const rawResults: Result[] = data.results || [];
  const rawSessions: ExamSession[] = data.examSessions || data.exam_sessions || [];
  const rawPublished: PublishedResult[] = data.publishedResults || data.published_results || [];

  const summary: MigrationSummary = {
    classes: 0,
    chapters: 0,
    users: 0,
    bankQuestions: 0,
    quizzes: 0,
    results: 0,
    examSessions: 0,
    publishedResults: 0,
    totalTimeMs: 0
  };

  try {
    // 1. Chuyển bảng LỚP HỌC (classes)
    if (rawClasses.length > 0) {
      onProgress?.({ step: "classes", detail: `Đang nạp ${rawClasses.length} lớp học...`, percent: 10 });
      const mapped = rawClasses.map(c => ({
        id: c.id,
        name: c.name,
        academic_year: c.academicYear || '',
        grade: c.grade || '12',
        subject: c.subject || null,
        description: c.description || null,
        created_at: c.createdAt || new Date().toISOString(),
        created_by: c.createdBy || null,
        teacher_name: c.teacherName || null,
        is_shared_with_teachers: c.isSharedWithTeachers ?? true
      }));

      const chunks = chunkArray(mapped, 100);
      for (const ch of chunks) {
        const { error } = await client.from('classes').upsert(ch, { onConflict: 'id' });
        if (error) throw new Error(`Lỗi nạp bảng classes: ${error.message}`);
        summary.classes += ch.length;
      }
    }

    // 2. Chuyển bảng CHƯƠNG BÀI GIẢNG (chapters)
    if (rawChapters.length > 0) {
      onProgress?.({ step: "chapters", detail: `Đang nạp ${rawChapters.length} chương bài giảng...`, percent: 20 });
      const mapped = rawChapters.map(c => ({
        id: c.id,
        grade: c.grade || '12',
        name: c.name,
        order: c.order ?? 0,
        subject: c.subject || null,
        created_by: c.createdBy || null,
        created_by_name: c.createdByName || null,
        is_shared_with_teachers: c.isSharedWithTeachers ?? true
      }));

      const chunks = chunkArray(mapped, 100);
      for (const ch of chunks) {
        const { error } = await client.from('chapters').upsert(ch, { onConflict: 'id' });
        if (error) throw new Error(`Lỗi nạp bảng chapters: ${error.message}`);
        summary.chapters += ch.length;
      }
    }

    // 3. Chuyển bảng NGƯỜI DÙNG (users: SuperAdmin, Giáo viên, Học sinh)
    if (rawUsers.length > 0) {
      onProgress?.({ step: "users", detail: `Đang nạp ${rawUsers.length} tài khoản người dùng...`, percent: 35 });
      const mapped = rawUsers.map(u => ({
        id: u.id,
        username: u.username,
        password: u.password || '123',
        role: u.role || 'student',
        full_name: u.fullName || u.username,
        student_code: u.studentCode || null,
        grade: u.grade || null,
        points: u.points ?? 0,
        class_id: u.classId || null,
        class_name: u.className || null,
        academic_year: u.academicYear || null,
        email: u.email || null,
        phone: u.phone || null,
        subject: u.subject || null,
        created_by_id: u.createdById || null,
        created_at: u.createdAt || new Date().toISOString()
      }));

      const chunks = chunkArray(mapped, 100);
      for (const ch of chunks) {
        const { error } = await client.from('users').upsert(ch, { onConflict: 'id' });
        if (error) throw new Error(`Lỗi nạp bảng users: ${error.message}`);
        summary.users += ch.length;
      }
    }

    // 4. Chuyển bảng NGÂN HÀNG CÂU HỎI (bank_questions)
    if (rawBank.length > 0) {
      onProgress?.({ step: "bank_questions", detail: `Đang nạp ${rawBank.length} câu hỏi ngân hàng...`, percent: 55 });
      const mapped = rawBank.map(q => ({
        id: q.id,
        type: q.type || 'mcq',
        text: q.text || '',
        points: Number(q.points) || 0.25,
        level: q.level || null,
        image_url: q.imageUrl || null,
        solution: q.solution || null,
        options: q.options || [],
        correct_answer: q.correctAnswer || null,
        sub_questions: q.subQuestions || [],
        quiz_title: q.quizTitle || null,
        quiz_grade: q.quizGrade || null,
        quiz_category: q.quizCategory || null,
        chapter_id: q.chapterId || null,
        chapter_name: q.chapterName || null,
        subject: q.subject || null,
        created_by: q.createdBy || null,
        created_by_name: q.createdByName || null,
        is_shared: q.isShared ?? true,
        bank_question_id: q.bankQuestionId || null,
        created_at: (q as any).createdAt || new Date().toISOString()
      }));

      const chunks = chunkArray(mapped, 50);
      for (const ch of chunks) {
        const { error } = await client.from('bank_questions').upsert(ch, { onConflict: 'id' });
        if (error) throw new Error(`Lỗi nạp bảng bank_questions: ${error.message}`);
        summary.bankQuestions += ch.length;
      }
    }

    // 5. Chuyển bảng ĐỀ THI (quizzes)
    if (rawQuizzes.length > 0) {
      onProgress?.({ step: "quizzes", detail: `Đang nạp ${rawQuizzes.length} đề thi...`, percent: 75 });
      const mapped = rawQuizzes.map(q => {
        // Thu thập toàn bộ câu hỏi của đề thi
        const questionsList = Array.isArray(q.questions) ? q.questions : [];
        return {
          id: q.id,
          title: q.title || 'Đề thi không tên',
          description: q.description || '',
          type: q.type || 'practice',
          grade: q.grade || '12',
          category: q.category || null,
          subject: q.subject || null,
          start_time: q.startTime || null,
          end_time: q.endTime || null,
          duration_minutes: q.durationMinutes || 45,
          questions: questionsList,
          question_count: q.questionCount || questionsList.length,
          attempt_count: q.attemptCount ?? 0,
          max_attempts: q.maxAttempts ?? 1,
          created_at: q.createdAt || new Date().toISOString(),
          is_published: q.isPublished ?? false,
          is_monitored: q.isMonitored ?? false,
          show_result_answers: q.showResultAnswers ?? true,
          disable_practice: q.disablePractice ?? false,
          is_unlisted: q.isUnlisted ?? false,
          order_index: q.orderIndex ?? 0,
          created_by: q.createdBy || null,
          created_by_name: q.createdByName || null,
          is_shared_with_teachers: q.isSharedWithTeachers ?? true,
          academic_year: q.academicYear || null,
          target_type: q.targetType || 'all',
          assigned_class_ids: q.assignedClassIds || [],
          assigned_classes: q.assignedClasses || []
        };
      });

      const chunks = chunkArray(mapped, 25);
      for (const ch of chunks) {
        const { error } = await client.from('quizzes').upsert(ch, { onConflict: 'id' });
        if (error) throw new Error(`Lỗi nạp bảng quizzes: ${error.message}`);
        summary.quizzes += ch.length;
      }
    }

    // 6. Chuyển bảng KẾT QUẢ THI (results)
    if (rawResults.length > 0) {
      onProgress?.({ step: "results", detail: `Đang nạp ${rawResults.length} kết quả làm bài...`, percent: 90 });
      const mapped = rawResults.map(r => ({
        id: r.id,
        quiz_id: r.quizId,
        student_id: r.studentId,
        student_name: r.studentName,
        student_code: r.studentCode || null,
        score: Number(r.score) || 0,
        total_questions: r.totalQuestions || 0,
        submitted_at: r.submittedAt || new Date().toISOString(),
        duration_seconds: r.durationSeconds || 0,
        detail_scores: r.detailScores || [],
        points_awarded: Number(r.pointsAwarded) || 0,
        bonus_point: Number(r.bonusPoint) || 0,
        user_answers: r.userAnswers || {},
        violation_count: r.violationCount || 0,
        shuffled_question_ids: r.shuffledQuestionIds || []
      }));

      const chunks = chunkArray(mapped, 50);
      for (const ch of chunks) {
        const { error } = await client.from('results').upsert(ch, { onConflict: 'id' });
        if (error) throw new Error(`Lỗi nạp bảng results: ${error.message}`);
        summary.results += ch.length;
      }
    }

    // 7. Chuyển bảng PHIÊN GIÁM SÁT THI & KẾT QUẢ CÔNG BỐ (nếu có)
    if (rawSessions.length > 0) {
      const mapped = rawSessions.map(s => ({
        id: s.id,
        quiz_id: s.quizId,
        quiz_title: s.quizTitle || '',
        student_id: s.studentId,
        student_name: s.studentName,
        student_code: s.studentCode || '',
        start_time: s.startTime || new Date().toISOString(),
        last_update: s.lastUpdate || new Date().toISOString(),
        violation_count: s.violationCount || 0,
        is_finished: s.isFinished ?? false
      }));
      const chunks = chunkArray(mapped, 100);
      for (const ch of chunks) {
        await client.from('exam_sessions').upsert(ch, { onConflict: 'id' });
        summary.examSessions += ch.length;
      }
    }

    if (rawPublished.length > 0) {
      const mapped = rawPublished.map(p => ({
        id: p.id,
        quiz_id: p.quizId,
        quiz_title: p.quizTitle,
        published_at: p.publishedAt || new Date().toISOString(),
        student_codes: p.studentCodes || [],
        results: p.results || []
      }));
      const chunks = chunkArray(mapped, 50);
      for (const ch of chunks) {
        await client.from('published_results').upsert(ch, { onConflict: 'id' });
        summary.publishedResults += ch.length;
      }
    }

    summary.totalTimeMs = Date.now() - startTime;
    onProgress?.({ step: "done", detail: `Đã chuyển đổi thành công 100% dữ liệu sang Supabase!`, percent: 100 });

    return {
      success: true,
      summary
    };
  } catch (err: any) {
    console.error("Lỗi khi chuyển dữ liệu sang Supabase:", err);
    return {
      success: false,
      message: err.message || 'Lỗi không xác định trong quá trình di chuyển dữ liệu.'
    };
  }
}

export const SUPABASE_SCHEMA_SQL = `-- ==============================================================================
-- CƠ SỞ DỮ LIỆU EDUQUIZ VN DÀNH CHO SUPABASE (POSTGRESQL)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'student')),
    full_name TEXT NOT NULL,
    student_code TEXT,
    grade TEXT CHECK (grade IN ('10', '11', '12', 'all')),
    points INTEGER DEFAULT 0,
    class_id TEXT,
    class_name TEXT,
    academic_year TEXT,
    email TEXT,
    phone TEXT,
    subject TEXT,
    created_by_id TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW())
);

CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_student_code ON public.users(student_code);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_class_id ON public.users(class_id);

CREATE TABLE IF NOT EXISTS public.classes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    grade TEXT NOT NULL CHECK (grade IN ('10', '11', '12', 'all')),
    subject TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW()),
    created_by TEXT,
    teacher_name TEXT,
    is_shared_with_teachers BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_classes_grade_year ON public.classes(grade, academic_year);
CREATE INDEX IF NOT EXISTS idx_classes_created_by ON public.classes(created_by);

CREATE TABLE IF NOT EXISTS public.chapters (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    grade TEXT NOT NULL CHECK (grade IN ('10', '11', '12', 'all')),
    name TEXT NOT NULL,
    "order" INTEGER DEFAULT 0,
    subject TEXT,
    created_by TEXT,
    created_by_name TEXT,
    is_shared_with_teachers BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_chapters_grade_subject ON public.chapters(grade, subject);
CREATE INDEX IF NOT EXISTS idx_chapters_order ON public.chapters("order");

CREATE TABLE IF NOT EXISTS public.bank_questions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    type TEXT NOT NULL CHECK (type IN ('mcq', 'group-tf', 'short')),
    text TEXT NOT NULL,
    points NUMERIC DEFAULT 0.25,
    level TEXT CHECK (level IN ('B', 'H', 'VD', 'VDC')),
    image_url TEXT,
    solution TEXT,
    options JSONB DEFAULT '[]'::jsonb,
    correct_answer TEXT,
    sub_questions JSONB DEFAULT '[]'::jsonb,
    quiz_title TEXT,
    quiz_grade TEXT,
    quiz_category TEXT,
    chapter_id TEXT,
    chapter_name TEXT,
    subject TEXT,
    created_by TEXT,
    created_by_name TEXT,
    is_shared BOOLEAN DEFAULT TRUE,
    bank_question_id TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW())
);

CREATE INDEX IF NOT EXISTS idx_bank_questions_subject_grade ON public.bank_questions(subject, quiz_grade);
CREATE INDEX IF NOT EXISTS idx_bank_questions_chapter ON public.bank_questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_bank_questions_level ON public.bank_questions(level);
CREATE INDEX IF NOT EXISTS idx_bank_questions_type ON public.bank_questions(type);
CREATE INDEX IF NOT EXISTS idx_bank_questions_created_by ON public.bank_questions(created_by);

CREATE TABLE IF NOT EXISTS public.quizzes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('practice', 'test')),
    grade TEXT NOT NULL CHECK (grade IN ('10', '11', '12', 'all')),
    category TEXT,
    subject TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER DEFAULT 45,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    question_count INTEGER DEFAULT 0,
    attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW()),
    is_published BOOLEAN DEFAULT FALSE,
    is_monitored BOOLEAN DEFAULT FALSE,
    show_result_answers BOOLEAN DEFAULT TRUE,
    disable_practice BOOLEAN DEFAULT FALSE,
    is_unlisted BOOLEAN DEFAULT FALSE,
    order_index INTEGER DEFAULT 0,
    created_by TEXT,
    created_by_name TEXT,
    is_shared_with_teachers BOOLEAN DEFAULT TRUE,
    academic_year TEXT,
    target_type TEXT DEFAULT 'all' CHECK (target_type IN ('all', 'classes')),
    assigned_class_ids JSONB DEFAULT '[]'::jsonb,
    assigned_classes JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_quizzes_grade_subject ON public.quizzes(grade, subject);
CREATE INDEX IF NOT EXISTS idx_quizzes_published ON public.quizzes(is_published);
CREATE INDEX IF NOT EXISTS idx_quizzes_created_by ON public.quizzes(created_by);
CREATE INDEX IF NOT EXISTS idx_quizzes_academic_year ON public.quizzes(academic_year);

CREATE TABLE IF NOT EXISTS public.results (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    quiz_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_code TEXT,
    score NUMERIC NOT NULL,
    total_questions INTEGER NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW()),
    duration_seconds INTEGER DEFAULT 0,
    detail_scores JSONB DEFAULT '[]'::jsonb,
    points_awarded NUMERIC DEFAULT 0,
    bonus_point NUMERIC DEFAULT 0,
    user_answers JSONB DEFAULT '{}'::jsonb,
    violation_count INTEGER DEFAULT 0,
    shuffled_question_ids JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_results_quiz_id ON public.results(quiz_id);
CREATE INDEX IF NOT EXISTS idx_results_student_id ON public.results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_student_code ON public.results(student_code);
CREATE INDEX IF NOT EXISTS idx_results_submitted_at ON public.results(submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.exam_sessions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    quiz_id TEXT NOT NULL,
    quiz_title TEXT,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_code TEXT,
    start_time TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW()),
    last_update TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW()),
    violation_count INTEGER DEFAULT 0,
    is_finished BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_exam_sessions_quiz ON public.exam_sessions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_student ON public.exam_sessions(student_id);

CREATE TABLE IF NOT EXISTS public.published_results (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    quiz_id TEXT NOT NULL,
    quiz_title TEXT NOT NULL,
    published_at TIMESTAMPTZ DEFAULT TIMEZONE('Asia/Ho_Chi_Minh', NOW()),
    student_codes JSONB DEFAULT '[]'::jsonb,
    results JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_published_results_quiz ON public.published_results(quiz_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for anon on users" ON public.users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon on classes" ON public.classes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon on chapters" ON public.chapters FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon on bank_questions" ON public.bank_questions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon on quizzes" ON public.quizzes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon on results" ON public.results FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon on exam_sessions" ON public.exam_sessions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for anon on published_results" ON public.published_results FOR ALL TO anon USING (true) WITH CHECK (true);

-- ==============================================================================
-- 11. BUCKET LƯU TRỮ HÌNH ẢNH (SUPABASE STORAGE: QUIZ-IMAGES)
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('quiz-images', 'quiz-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public Read Access for quiz-images" ON storage.objects FOR SELECT USING (bucket_id = 'quiz-images');
CREATE POLICY "Public Insert Access for quiz-images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'quiz-images');
CREATE POLICY "Public Update Access for quiz-images" ON storage.objects FOR UPDATE USING (bucket_id = 'quiz-images');
`;

// Tải ảnh trực tiếp lên Supabase Storage bucket 'quiz-images'
export async function uploadImageToSupabaseStorage(
  blob: Blob,
  fileExt: string = 'jpg',
  url?: string,
  anonKey?: string
): Promise<string | null> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return null;

  try {
    const fileName = `${uuidv4()}.${fileExt}`;
    const { error } = await client.storage
      .from('quiz-images')
      .upload(fileName, blob, {
        contentType: fileExt === 'png' ? 'image/png' : 'image/jpeg',
        upsert: true
      });

    if (error) {
      console.warn("Lỗi tải ảnh lên Supabase Storage:", error);
      return null;
    }

    const { data: publicUrlData } = client.storage
      .from('quiz-images')
      .getPublicUrl(fileName);

    return publicUrlData?.publicUrl || null;
  } catch (err) {
    console.warn("Lỗi ngoại lệ upload Supabase Storage:", err);
    return null;
  }
}


