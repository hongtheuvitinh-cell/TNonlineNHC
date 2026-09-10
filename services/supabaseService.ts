import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Quiz, Result, Chapter, Question, ExamSession, PublishedResult, Grade, ClassRoom } from '../types';
import { getSavedSupabaseConfig } from './supabaseMigration';
import { normalizeDateTimeForStorage } from './dateUtils';
import { normalizeSubject } from './subjectUtils';
import { v4 as uuidv4 } from 'uuid';

let _supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (_supabaseClient) return _supabaseClient;
  const config = getSavedSupabaseConfig();
  if (config.url && config.anonKey) {
    try {
      _supabaseClient = createClient(config.url.trim(), config.anonKey.trim(), {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    } catch (e) {
      console.error("Lỗi khởi tạo Supabase:", e);
    }
  }
  return _supabaseClient;
}

export function resetSupabaseClient(): void {
  _supabaseClient = null;
}

export function isSupabaseConnected(): boolean {
  return !!getSupabase();
}

// ----------------------------------------------------
// MAPPERS: Object to Supabase Row & Supabase Row to Object
// ----------------------------------------------------

export function mapUserFromDb(row: any): User {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    role: row.role,
    fullName: row.full_name || row.fullName || row.username,
    studentCode: row.student_code || row.studentCode || undefined,
    grade: row.grade || undefined,
    points: row.points ?? 0,
    classId: row.class_id || row.classId || undefined,
    className: row.class_name || row.className || undefined,
    academicYear: row.academic_year || row.academicYear || undefined,
    email: row.email || undefined,
    phone: row.phone || undefined,
    subject: row.subject || undefined,
    createdById: row.created_by_id || row.createdById || undefined,
    createdAt: row.created_at || row.createdAt || undefined
  };
}

export function mapUserToDb(u: User): any {
  return {
    id: u.id || uuidv4(),
    username: u.username.trim().toLowerCase(),
    password: u.password || '123',
    role: u.role || 'student',
    full_name: u.fullName || u.username,
    student_code: u.studentCode ? u.studentCode.trim().toUpperCase() : null,
    grade: u.grade || null,
    points: typeof u.points === 'number' ? u.points : Number(u.points) || 0,
    class_id: u.classId || null,
    class_name: u.className || null,
    academic_year: u.academicYear || null,
    email: u.email || null,
    phone: u.phone || null,
    subject: u.subject || null,
    created_by_id: u.createdById || null,
    created_at: u.createdAt || new Date().toISOString()
  };
}

export function mapClassFromDb(row: any): ClassRoom {
  return {
    id: row.id,
    name: row.name,
    academicYear: row.academic_year || row.academicYear || '',
    grade: row.grade || '12',
    subject: row.subject || undefined,
    description: row.description || undefined,
    createdAt: row.created_at || row.createdAt,
    createdBy: row.created_by || row.createdBy,
    teacherName: row.teacher_name || row.teacherName,
    isSharedWithTeachers: row.is_shared_with_teachers ?? row.isSharedWithTeachers ?? true,
    studentCount: row.student_count ?? row.studentCount ?? undefined
  };
}

export function mapClassToDb(c: ClassRoom): any {
  return {
    id: c.id || uuidv4(),
    name: c.name,
    academic_year: c.academicYear || '',
    grade: c.grade || '12',
    subject: c.subject || null,
    description: c.description || null,
    created_at: c.createdAt || new Date().toISOString(),
    created_by: c.createdBy || null,
    teacher_name: c.teacherName || null,
    is_shared_with_teachers: c.isSharedWithTeachers ?? true
  };
}

export function mapChapterFromDb(row: any): Chapter {
  return {
    id: row.id,
    grade: row.grade || '12',
    name: row.name,
    order: row.order ?? 0,
    subject: row.subject || undefined,
    createdBy: row.created_by || row.createdBy,
    createdByName: row.created_by_name || row.createdByName,
    isSharedWithTeachers: row.is_shared_with_teachers ?? row.isSharedWithTeachers ?? true
  };
}

export function mapChapterToDb(c: Chapter): any {
  return {
    id: c.id || uuidv4(),
    grade: c.grade || '12',
    name: c.name,
    order: c.order ?? 0,
    subject: c.subject || null,
    created_by: c.createdBy || null,
    created_by_name: c.createdByName || null,
    is_shared_with_teachers: c.isSharedWithTeachers ?? true
  };
}

export function mapBankQuestionFromDb(row: any): Question {
  return {
    id: row.id,
    type: row.type || 'mcq',
    text: row.text,
    points: Number(row.points) || 0.25,
    level: row.level || undefined,
    imageUrl: row.image_url || row.imageUrl || undefined,
    solution: row.solution || undefined,
    options: row.options || [],
    correctAnswer: row.correct_answer || row.correctAnswer || undefined,
    subQuestions: row.sub_questions || row.subQuestions || [],
    quizTitle: row.quiz_title || row.quizTitle || undefined,
    quizGrade: row.quiz_grade || row.quizGrade || undefined,
    quizCategory: row.quiz_category || row.quizCategory || undefined,
    chapterId: row.chapter_id || row.chapterId || undefined,
    chapterName: row.chapter_name || row.chapterName || undefined,
    subject: row.subject || undefined,
    createdBy: row.created_by || row.createdBy || undefined,
    createdByName: row.created_by_name || row.createdByName || undefined,
    isShared: row.is_shared ?? row.isShared ?? true,
    bankQuestionId: row.bank_question_id || row.bankQuestionId || undefined
  };
}

export function mapBankQuestionToDb(q: Question): any {
  return {
    id: q.id || uuidv4(),
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
    created_at: new Date().toISOString()
  };
}

export function mapQuizFromDb(row: any): Quiz {
  const questionsList = Array.isArray(row.questions) ? row.questions : [];
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    type: row.type || 'practice',
    grade: row.grade || '12',
    category: row.category || undefined,
    subject: row.subject || undefined,
    startTime: row.start_time || row.startTime || undefined,
    endTime: row.end_time || row.endTime || undefined,
    durationMinutes: row.duration_minutes || row.durationMinutes || 45,
    questions: questionsList,
    questionCount: row.question_count ?? questionsList.length,
    attemptCount: row.attempt_count ?? row.attemptCount ?? 0,
    maxAttempts: row.max_attempts ?? row.maxAttempts ?? 1,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    isPublished: row.is_published ?? row.isPublished ?? false,
    isMonitored: row.is_monitored ?? row.isMonitored ?? false,
    showResultAnswers: row.show_result_answers ?? row.showResultAnswers ?? true,
    disablePractice: row.disable_practice ?? row.disablePractice ?? false,
    isUnlisted: row.is_unlisted ?? row.isUnlisted ?? false,
    orderIndex: row.order_index ?? row.orderIndex ?? 0,
    createdBy: row.created_by || row.createdBy || undefined,
    createdByName: row.created_by_name || row.createdByName || undefined,
    isSharedWithTeachers: row.is_shared_with_teachers ?? row.isSharedWithTeachers ?? true,
    academicYear: row.academic_year || row.academicYear || undefined,
    targetType: row.target_type || row.targetType || 'all',
    assignedClassIds: row.assigned_class_ids || row.assignedClassIds || [],
    assignedClasses: row.assigned_classes || row.assignedClasses || []
  };
}

export function mapQuizToDb(q: Quiz): any {
  const questionsList = Array.isArray(q.questions) ? q.questions : [];
  return {
    id: q.id || uuidv4(),
    title: q.title || 'Đề thi không tên',
    description: q.description || '',
    type: q.type || 'practice',
    grade: q.grade || '12',
    category: q.category || null,
    subject: q.subject || null,
    start_time: normalizeDateTimeForStorage(q.startTime),
    end_time: normalizeDateTimeForStorage(q.endTime),
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
}

export function mapResultFromDb(row: any): Result {
  return {
    id: row.id,
    quizId: row.quiz_id || row.quizId,
    studentId: row.student_id || row.studentId,
    studentName: row.student_name || row.studentName,
    studentCode: row.student_code || row.studentCode || undefined,
    score: Number(row.score) || 0,
    totalQuestions: row.total_questions || row.totalQuestions || 0,
    submittedAt: row.submitted_at || row.submittedAt || new Date().toISOString(),
    durationSeconds: row.duration_seconds || row.durationSeconds || 0,
    detailScores: row.detail_scores || row.detailScores || [],
    pointsAwarded: Number(row.points_awarded ?? row.pointsAwarded ?? 0),
    bonusPoint: Number(row.bonus_point ?? row.bonusPoint ?? 0),
    userAnswers: row.user_answers || row.userAnswers || {},
    violationCount: row.violation_count ?? row.violationCount ?? 0,
    shuffledQuestionIds: row.shuffled_question_ids || row.shuffledQuestionIds || []
  };
}

export function mapResultToDb(r: Result): any {
  return {
    id: r.id || uuidv4(),
    quiz_id: r.quizId,
    student_id: r.studentId,
    student_name: r.studentName,
    student_code: r.studentCode ? r.studentCode.trim().toUpperCase() : null,
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
  };
}

// ----------------------------------------------------
// SUPABASE CRUD OPERATIONS
// ----------------------------------------------------

export const supabaseDb = {
  // Test Connection
  async ping(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const startTime = Date.now();
    const client = getSupabase();
    if (!client) return { success: false, message: 'Chưa cấu hình Supabase Client', latencyMs: 0 };
    try {
      const { data, error } = await client.from('classes').select('id').limit(1);
      const latencyMs = Date.now() - startTime;
      if (error) {
        return { success: false, message: `Lỗi Supabase: ${error.message}`, latencyMs };
      }
      return { success: true, message: `Kết nối Supabase (PostgreSQL) thành công! Độ trễ: ${latencyMs}ms`, latencyMs };
    } catch (e: any) {
      return { success: false, message: e.message || 'Lỗi kết nối Supabase', latencyMs: 0 };
    }
  },

  // USERS
  async findUser(username: string): Promise<User | undefined> {
    const client = getSupabase();
    if (!client) return undefined;
    const clean = username.trim().toLowerCase();
    const { data, error } = await client.from('users').select('*').ilike('username', clean).maybeSingle();
    if (error || !data) return undefined;
    return mapUserFromDb(data);
  },

  async findUserByStudentCode(code: string): Promise<User | undefined> {
    const client = getSupabase();
    if (!client) return undefined;
    const clean = code.trim().toUpperCase();
    const { data, error } = await client.from('users').select('*').eq('student_code', clean).maybeSingle();
    if (error || !data) return undefined;
    return mapUserFromDb(data);
  },

  async saveUser(user: User): Promise<void> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');
    const row = mapUserToDb(user);
    const { error } = await client.from('users').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi lưu người dùng: ${error.message}`);
  },

  async saveUsersBatch(users: User[]): Promise<void> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');
    const rows = users.map(mapUserToDb);
    const { error } = await client.from('users').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi lưu danh sách người dùng: ${error.message}`);
  },

  async getUsers(): Promise<User[]> {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('users').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapUserFromDb);
  },

  async getUsersPage(page: number, pageSize: number = 50, search?: string): Promise<{ data: User[]; total: number }> {
    const client = getSupabase();
    if (!client) return { data: [], total: 0 };
    let q = client.from('users').select('*', { count: 'exact' });
    if (search && search.trim()) {
      const s = search.trim();
      q = q.or(`full_name.ilike.%${s}%,username.ilike.%${s}%,student_code.ilike.%${s}%`);
    }
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await q.range(from, to).order('created_at', { ascending: false });
    if (error || !data) return { data: [], total: 0 };
    return { data: data.map(mapUserFromDb), total: count || 0 };
  },

  async deleteUser(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('users').delete().eq('id', id);
  },

  async changePassword(userId: string, newPass: string): Promise<boolean> {
    const client = getSupabase();
    if (!client) return false;
    const { error } = await client.from('users').update({ password: newPass }).eq('id', userId);
    return !error;
  },

  async addPointsToUser(userId: string, points: number): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    const { data } = await client.from('users').select('points').eq('id', userId).maybeSingle();
    const current = (data?.points ?? 0) + points;
    await client.from('users').update({ points: current }).eq('id', userId);
  },

  // CLASSES
  async getClasses(): Promise<ClassRoom[]> {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('classes').select('*').order('name', { ascending: true });
    if (error || !data) return [];
    return data.map(mapClassFromDb);
  },

  async saveClass(c: ClassRoom): Promise<void> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');
    const row = mapClassToDb(c);
    const { error } = await client.from('classes').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi lưu lớp học: ${error.message}`);
  },

  async saveClassesBatch(classesList: ClassRoom[]): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    const rows = classesList.map(mapClassToDb);
    await client.from('classes').upsert(rows, { onConflict: 'id' });
  },

  async deleteClass(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('classes').delete().eq('id', id);
  },

  async assignStudentsToClass(studentIds: string[], classId?: string | null, className?: string | null, academicYear?: string): Promise<number> {
    const client = getSupabase();
    if (!client || studentIds.length === 0) return 0;
    const updatePayload: any = { 
      class_id: classId && classId.trim() ? classId.trim() : null, 
      class_name: className && className.trim() ? className.trim() : null 
    };
    if (academicYear !== undefined) {
      updatePayload.academic_year = academicYear && academicYear.trim() ? academicYear.trim() : null;
    }
    const { error } = await client.from('users').update(updatePayload).in('id', studentIds);
    return error ? 0 : studentIds.length;
  },

  async getStudentsByClass(classId: string, className?: string, academicYear?: string): Promise<User[]> {
    const client = getSupabase();
    if (!client) return [];
    let q = client.from('users').select('*').eq('role', 'student');
    if (className && academicYear) {
      q = q.or(`class_id.eq.${classId},and(class_name.eq.${className},academic_year.eq.${academicYear})`);
    } else {
      q = q.eq('class_id', classId);
    }
    const { data, error } = await q.order('full_name', { ascending: true });
    if (error || !data) return [];
    return data.map(mapUserFromDb);
  },

  async getUnassignedStudents(): Promise<User[]> {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('users')
      .select('*')
      .eq('role', 'student')
      .order('full_name', { ascending: true })
      .limit(1000);
    if (error || !data) return [];
    return data.map(mapUserFromDb).filter(u => !u.classId && !u.className);
  },

  // CHAPTERS
  async getChapters(): Promise<Chapter[]> {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('chapters').select('*').order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(mapChapterFromDb);
  },

  async saveChapter(c: Chapter): Promise<void> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');
    const row = mapChapterToDb(c);
    const { error } = await client.from('chapters').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi lưu chương: ${error.message}`);
  },

  async deleteChapter(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('chapters').delete().eq('id', id);
  },

  async deleteChaptersBatch(ids: string[]): Promise<void> {
    const client = getSupabase();
    if (!client || ids.length === 0) return;
    await client.from('chapters').delete().in('id', ids);
  },

  // BANK QUESTIONS
  async getBankQuestions(filters?: { subject?: string; grade?: string; limit?: number; offset?: number }): Promise<Question[]> {
    const client = getSupabase();
    if (!client) return [];
    let query = client.from('bank_questions').select('*');

    if (filters?.grade && filters.grade !== 'all') {
      query = query.eq('quiz_grade', filters.grade);
    }

    if (filters?.subject && filters.subject !== 'all') {
      const norm = normalizeSubject(filters.subject);
      if (norm === 'vật lý') {
        query = query.or('subject.ilike.%vật lí%,subject.ilike.%vật lý%');
      } else if (norm === 'địa lý') {
        query = query.or('subject.ilike.%địa lí%,subject.ilike.%địa lý%');
      } else if (norm === 'hóa học') {
        query = query.or('subject.ilike.%hóa%,subject.ilike.%hoá%');
      } else {
        query = query.ilike('subject', `%${filters.subject.trim()}%`);
      }
    }

    if (filters?.limit) {
      if (filters.offset !== undefined) {
        query = query.range(filters.offset, filters.offset + filters.limit - 1);
      } else {
        query = query.limit(filters.limit);
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error || !data) {
      if (error) console.error("Lỗi Supabase getBankQuestions:", error);
      return [];
    }
    return data.map(mapBankQuestionFromDb);
  },

  async saveBankQuestion(q: Question): Promise<void> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');
    const row = mapBankQuestionToDb(q);
    const { error } = await client.from('bank_questions').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi lưu câu hỏi: ${error.message}`);
  },

  async saveBatchBankQuestions(questions: Question[]): Promise<number> {
    const client = getSupabase();
    if (!client || questions.length === 0) return 0;
    
    // Đảm bảo không có ID trùng lặp trong danh sách upsert để tránh lỗi PostgreSQL "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const uniqueMap = new Map<string, Question>();
    questions.forEach(q => {
      if (q && q.id) {
        uniqueMap.set(q.id, q);
      }
    });
    const uniqueQuestions = Array.from(uniqueMap.values());
    if (uniqueQuestions.length === 0) return 0;

    const chunkSize = 200;
    let saved = 0;
    for (let i = 0; i < uniqueQuestions.length; i += chunkSize) {
      const chunk = uniqueQuestions.slice(i, i + chunkSize);
      const rows = chunk.map(mapBankQuestionToDb);
      const { error } = await client.from('bank_questions').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error("Lỗi batch upsert bank_questions sang Supabase:", error);
        throw new Error(`Lỗi lưu danh sách câu hỏi: ${error.message}`);
      }
      saved += chunk.length;
    }
    return saved;
  },

  async deleteBankQuestion(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('bank_questions').delete().eq('id', id);
  },

  async deleteBatchBankQuestions(ids: string[]): Promise<number> {
    const client = getSupabase();
    if (!client || ids.length === 0) return 0;
    const { error } = await client.from('bank_questions').delete().in('id', ids);
    return error ? 0 : ids.length;
  },

  // QUIZZES
  async getQuizzes(grade?: Grade): Promise<Quiz[]> {
    const client = getSupabase();
    if (!client) return [];
    let q = client.from('quizzes').select('*');
    if (grade && grade !== 'all') {
      q = q.eq('grade', grade);
    }
    const { data, error } = await q.order('order_index', { ascending: true }).order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapQuizFromDb);
  },

  async getQuizzesMetadata(grade?: Grade): Promise<Quiz[]> {
    const client = getSupabase();
    if (!client) return [];
    let q = client.from('quizzes').select('id, title, description, type, grade, category, subject, start_time, end_time, duration_minutes, question_count, attempt_count, max_attempts, created_at, is_published, is_monitored, show_result_answers, disable_practice, is_unlisted, order_index, created_by, created_by_name, is_shared_with_teachers, academic_year, target_type, assigned_class_ids, assigned_classes');
    if (grade && grade !== 'all') {
      q = q.eq('grade', grade);
    }
    const { data, error } = await q.order('order_index', { ascending: true }).order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapQuizFromDb);
  },

  async getQuizById(id: string): Promise<Quiz | null> {
    const client = getSupabase();
    if (!client) return null;
    const { data, error } = await client.from('quizzes').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapQuizFromDb(data);
  },

  async saveQuiz(quiz: Quiz): Promise<void> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');
    const row = mapQuizToDb(quiz);
    const { error } = await client.from('quizzes').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi lưu đề thi: ${error.message}`);
  },

  async deleteQuiz(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('quizzes').delete().eq('id', id);
  },

  async updateQuizShareStatus(quizId: string, isShared: boolean): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('quizzes').update({ is_shared_with_teachers: isShared }).eq('id', quizId);
  },

  async updateQuizAcademicYear(quizId: string, academicYear: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('quizzes').update({ academic_year: academicYear }).eq('id', quizId);
  },

  async updateQuizSchedule(quizId: string, startTime: string | null, endTime: string | null): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    const cleanStart = normalizeDateTimeForStorage(startTime);
    const cleanEnd = normalizeDateTimeForStorage(endTime);
    await client.from('quizzes').update({ start_time: cleanStart, end_time: cleanEnd }).eq('id', quizId);
  },

  async assignQuizToClasses(
    quizId: string, 
    assignedClassIds: string[], 
    teacherManagedClassIds?: string[]
  ): Promise<{ finalClassIds: string[]; targetType: string }> {
    const client = getSupabase();
    if (!client) return { finalClassIds: assignedClassIds, targetType: 'classes' };
    
    // Lấy đề hiện tại để bảo toàn các lớp của giáo viên khác
    let finalClassIds: string[] = assignedClassIds;
    let targetType = 'classes';

    const { data: currentQuiz } = await client
      .from('quizzes')
      .select('assigned_class_ids, target_type')
      .eq('id', quizId)
      .maybeSingle();

    if (currentQuiz) {
      if (teacherManagedClassIds && teacherManagedClassIds.length > 0) {
        const otherIds = (currentQuiz.assigned_class_ids || []).filter(
          (id: string) => !teacherManagedClassIds.includes(id)
        );
        finalClassIds = Array.from(new Set([...otherIds, ...assignedClassIds]));
      } else {
        finalClassIds = assignedClassIds;
      }
      targetType = finalClassIds.length > 0 ? 'classes' : (currentQuiz.target_type || 'classes');
    } else {
      targetType = finalClassIds.length > 0 ? 'classes' : 'classes';
    }

    await client.from('quizzes').update({
      target_type: targetType,
      assigned_class_ids: finalClassIds
    }).eq('id', quizId);

    return { finalClassIds, targetType };
  },

  // RESULTS
  async getResults(quizId?: string, maxRecords: number = 5000): Promise<Result[]> {
    const client = getSupabase();
    if (!client) return [];
    let q = client.from('results').select('*').limit(maxRecords);
    if (quizId && quizId !== 'all') {
      q = q.eq('quiz_id', quizId);
    }
    const { data, error } = await q.order('submitted_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapResultFromDb);
  },

  async getResultsForStudent(studentId: string, studentCode?: string): Promise<Result[]> {
    const client = getSupabase();
    if (!client) return [];
    let q = client.from('results').select('*').limit(500);
    if (studentCode && studentCode !== 'N/A') {
      q = q.or(`student_id.eq.${studentId},student_code.eq.${studentCode.trim().toUpperCase()}`);
    } else {
      q = q.eq('student_id', studentId);
    }
    const { data, error } = await q.order('submitted_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapResultFromDb);
  },

  async getResultById(id: string): Promise<Result | null> {
    const client = getSupabase();
    if (!client) return null;
    const { data, error } = await client.from('results').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapResultFromDb(data);
  },

  async saveResult(result: Result): Promise<void> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');
    const row = mapResultToDb(result);
    const { error } = await client.from('results').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi lưu kết quả thi: ${error.message}`);
  },

  async deleteResult(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('results').delete().eq('id', id);
  },

  async updateResultCode(id: string, code: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('results').update({ student_code: code.trim().toUpperCase() }).eq('id', id);
  },

  // EXAM SESSIONS
  async getExamSessions(quizId?: string): Promise<ExamSession[]> {
    const client = getSupabase();
    if (!client) return [];
    let q = client.from('exam_sessions').select('*');
    if (quizId) {
      q = q.eq('quiz_id', quizId);
    }
    const { data, error } = await q.order('start_time', { ascending: false });
    if (error || !data) return [];
    return data.map((s: any) => ({
      id: s.id,
      quizId: s.quiz_id,
      quizTitle: s.quiz_title,
      studentId: s.student_id,
      studentName: s.student_name,
      studentCode: s.student_code,
      startTime: s.start_time,
      lastUpdate: s.last_update,
      violationCount: s.violation_count ?? 0,
      isFinished: s.is_finished ?? false
    }));
  },

  async getStudentActiveSessions(studentId: string): Promise<ExamSession[]> {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from('exam_sessions')
      .select('*')
      .eq('student_id', studentId)
      .eq('is_finished', false);
    if (error || !data) return [];
    return data.map((s: any) => ({
      id: s.id,
      quizId: s.quiz_id,
      quizTitle: s.quiz_title,
      studentId: s.student_id,
      studentName: s.student_name,
      studentCode: s.student_code,
      startTime: s.start_time,
      lastUpdate: s.last_update,
      violationCount: s.violation_count ?? 0,
      isFinished: s.is_finished ?? false
    }));
  },

  async saveExamSession(session: ExamSession): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    const row = {
      id: session.id || uuidv4(),
      quiz_id: session.quizId,
      quiz_title: session.quizTitle || '',
      student_id: session.studentId,
      student_name: session.studentName,
      student_code: session.studentCode || '',
      start_time: session.startTime || new Date().toISOString(),
      last_update: session.lastUpdate || new Date().toISOString(),
      violation_count: session.violationCount || 0,
      is_finished: session.isFinished ?? false
    };
    await client.from('exam_sessions').upsert(row, { onConflict: 'id' });
  },

  async deleteExamSession(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('exam_sessions').delete().eq('id', id);
  },

  async clearAllSessions(): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('exam_sessions').delete().neq('id', 'placeholder_keep');
  },

  // TEACHERS
  async getTeachers(): Promise<User[]> {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('users').select('*').in('role', ['admin', 'superadmin']).order('full_name', { ascending: true });
    if (error || !data) return [];
    return data.map(mapUserFromDb);
  },

  // RESULTS PAGINATION
  async getResultsMetadataPage(page: number, pageSize: number = 50, quizId?: string, search?: string): Promise<{ data: Result[]; total: number }> {
    const client = getSupabase();
    if (!client) return { data: [], total: 0 };
    let q = client.from('results').select('*', { count: 'exact' });
    if (quizId && quizId !== 'all') {
      q = q.eq('quiz_id', quizId);
    }
    if (search && search.trim()) {
      const s = search.trim();
      q = q.or(`student_name.ilike.%${s}%,student_code.ilike.%${s}%`);
    }
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await q.range(from, to).order('submitted_at', { ascending: false });
    if (error || !data) return { data: [], total: 0 };
    return { data: data.map(mapResultFromDb), total: count || 0 };
  },

  async getResultsCount(quizId?: string): Promise<number> {
    const client = getSupabase();
    if (!client) return 0;
    let q = client.from('results').select('*', { count: 'exact', head: true });
    if (quizId && quizId !== 'all') {
      q = q.eq('quiz_id', quizId);
    }
    const { count, error } = await q;
    return error ? 0 : (count || 0);
  },

  // METRICS
  async getDatabaseMetrics(): Promise<any> {
    const client = getSupabase();
    const config = getSavedSupabaseConfig();
    let latencyMs = 0;
    let connected = false;
    let status: 'optimal' | 'warning' | 'error' = 'optimal';

    const tables = [
      { name: 'users', label: 'Tài khoản người dùng', avgBytes: 800, desc: 'Học sinh, giáo viên, quản trị viên' },
      { name: 'classes', label: 'Lớp học', avgBytes: 1200, desc: 'Danh sách lớp và danh sách mã học sinh được gán' },
      { name: 'chapters', label: 'Chương mục kiến thức', avgBytes: 400, desc: 'Phân loại bài học theo từng khối và môn' },
      { name: 'bank_questions', label: 'Ngân hàng câu hỏi', avgBytes: 2200, desc: 'Kho câu hỏi mẫu phân theo môn học và mức độ' },
      { name: 'quizzes', label: 'Đề thi chi tiết', avgBytes: 18000, desc: 'Chứa đề thi, danh sách câu hỏi, hình ảnh và đáp án' },
      { name: 'results', label: 'Kết quả & Bài nộp', avgBytes: 4500, desc: 'Chi tiết bài thi của học sinh, đáp án chọn, thời gian làm' },
      { name: 'exam_sessions', label: 'Phiên giám sát thi', avgBytes: 1000, desc: 'Trạng thái học sinh đang làm bài thi trực tiếp' },
      { name: 'published_results', label: 'Kết quả công bố', avgBytes: 800, desc: 'Dữ liệu công bố điểm của các đề thi' }
    ];

    const collectionsStats: any[] = [];
    let totalDocs = 0;
    let totalEstimatedBytes = 0;

    if (client) {
      try {
        const pingStart = performance.now();
        const { error: pingErr } = await client.from('classes').select('id').limit(1);
        latencyMs = Math.round(performance.now() - pingStart);
        connected = !pingErr;
        if (connected) {
          for (const tbl of tables) {
            const { count, error } = await client.from(tbl.name).select('*', { count: 'exact', head: true });
            const docCount = (!error && typeof count === 'number') ? count : 0;
            const sizeBytes = docCount * tbl.avgBytes;
            totalDocs += docCount;
            totalEstimatedBytes += sizeBytes;
            collectionsStats.push({
              name: tbl.name,
              label: tbl.label,
              count: docCount,
              documentCount: docCount,
              estimatedSizeBytes: sizeBytes,
              description: tbl.desc,
              loadStrategy: 'Supabase PostgreSQL Table',
              readsToday: 0,
              estimatedReadsPerLoad: docCount
            });
          }
        }
      } catch (e) {
        status = 'error';
      }
    }

    let host = 'kosgiekqtutjegalbxyq.supabase.co';
    try {
      if (config.url) host = new URL(config.url).hostname;
    } catch {}

    return {
      connected,
      projectId: host.split('.')[0] || 'kosgiekqtutjegalbxyq',
      databaseId: 'Supabase PostgreSQL (Active Backend)',
      storageBucket: 'quiz-images (Supabase Storage)',
      authDomain: host,
      latencyMs,
      status,
      collections: collectionsStats,
      totalDocuments: totalDocs,
      totalEstimatedSizeBytes: totalEstimatedBytes,
      localCacheSizeBytes: 0,
      dailyStats: {
        date: new Date().toLocaleDateString('en-CA'),
        totalReads: 0,
        totalWrites: 0,
        totalDeletes: 0,
        readsByCollection: {},
        lastUpdated: new Date().toISOString()
      },
      quotas: {
        readsDailyLimit: 500000,
        writesDailyLimit: 500000,
        deletesDailyLimit: 500000,
        storageLimitBytes: 524288000,
        bandwidthMonthlyLimitBytes: 2147483648,
        estimatedStorageUsedPercent: Math.min(100, Number(((totalEstimatedBytes / 524288000) * 100).toFixed(2))),
        readsUsedPercent: 0
      },
      lastChecked: new Date().toISOString()
    };
  },

  // PUBLISHED RESULTS
  async getPublishedResults(limitCount: number = 20): Promise<PublishedResult[]> {
    const client = getSupabase();
    if (!client) return [];
    const { data, error } = await client.from('published_results').select('*').limit(limitCount).order('published_at', { ascending: false });
    if (error || !data) return [];
    return data.map((p: any) => ({
      id: p.id,
      quizId: p.quiz_id,
      quizTitle: p.quiz_title,
      publishedAt: p.published_at,
      studentCodes: p.student_codes || [],
      results: p.results || []
    }));
  },

  async savePublishedResult(pub: PublishedResult): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    const row = {
      id: pub.id || uuidv4(),
      quiz_id: pub.quizId,
      quiz_title: pub.quizTitle,
      published_at: pub.publishedAt || new Date().toISOString(),
      student_codes: pub.studentCodes || [],
      results: pub.results || []
    };
    await client.from('published_results').upsert(row, { onConflict: 'id' });
  },

  async deletePublishedResult(id: string): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    await client.from('published_results').delete().eq('id', id);
  },

  // EXPORT FULL BACKUP FROM SUPABASE
  async exportFullDatabaseBackup(): Promise<string> {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client chưa kết nối');

    const [
      quizzesRes,
      usersRes,
      resultsRes,
      classesRes,
      chaptersRes,
      bankRes,
      sessionsRes,
      publishedRes
    ] = await Promise.all([
      client.from('quizzes').select('*'),
      client.from('users').select('*'),
      client.from('results').select('*'),
      client.from('classes').select('*'),
      client.from('chapters').select('*'),
      client.from('bank_questions').select('*'),
      client.from('exam_sessions').select('*'),
      client.from('published_results').select('*')
    ]);

    const quizzes = (quizzesRes.data || []).map(mapQuizFromDb);
    const users = (usersRes.data || []).map(mapUserFromDb);
    const results = (resultsRes.data || []).map(mapResultFromDb);
    const classes = (classesRes.data || []).map(mapClassFromDb);
    const chapters = (chaptersRes.data || []).map(mapChapterFromDb);
    const bankQuestions = (bankRes.data || []).map(mapBankQuestionFromDb);
    const examSessions = (sessionsRes.data || []).map((s: any) => ({
      id: s.id,
      quizId: s.quiz_id,
      quizTitle: s.quiz_title,
      studentId: s.student_id,
      studentName: s.student_name,
      studentCode: s.student_code,
      startTime: s.start_time,
      lastUpdate: s.last_update,
      violationCount: s.violation_count ?? 0,
      isFinished: s.is_finished ?? false
    }));
    const publishedResults = (publishedRes.data || []).map((p: any) => ({
      id: p.id,
      quizId: p.quiz_id,
      quizTitle: p.quiz_title,
      publishedAt: p.published_at,
      studentCodes: p.student_codes || [],
      results: p.results || []
    }));

    const backupData = {
      version: "3.0",
      appName: "EduQuiz VN (Supabase PostgreSQL)",
      exportedAt: new Date().toISOString(),
      provider: "supabase",
      stats: {
        quizzes: quizzes.length,
        users: users.length,
        results: results.length,
        classes: classes.length,
        chapters: chapters.length,
        bankQuestions: bankQuestions.length,
        examSessions: examSessions.length,
        publishedResults: publishedResults.length
      },
      data: {
        quizzes,
        users,
        results,
        classes,
        chapters,
        bankQuestions,
        examSessions,
        publishedResults
      }
    };

    return JSON.stringify(backupData, null, 2);
  }
};
