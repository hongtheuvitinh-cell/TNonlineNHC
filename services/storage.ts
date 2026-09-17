
/// <reference types="vite/client" />

import { createClient } from '@supabase/supabase-js';
import { User, Quiz, Result, Chapter, QuizFolder, Question, ExamSession, PublishedResult, Grade, ClassRoom } from '../types';
import { v4 as uuidv4 } from 'uuid';

let cleanedUrl = (import.meta.env.VITE_SUPABASE_URL || 'https://lchfhsioxvgkjfsikycl.supabase.co').trim();
if (cleanedUrl.endsWith('/rest/v1') || cleanedUrl.endsWith('/rest/v1/')) {
    cleanedUrl = cleanedUrl.replace(/\/rest\/v1\/?$/, '');
}
const SUPABASE_URL = cleanedUrl;

const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjaGZoc2lveHZna2pmc2lreWNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NTI3MDksImV4cCI6MjA4MDUyODcwOX0.toOc2ytPzo_cqhpQyd0YOLq4Zvk3BtfdZSziXN__j8Q').trim();

let supabase: any = null;

try {
  if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (e) {
  console.error("Lỗi khởi tạo Supabase:", e);
}

// Helper timeout an toàn để Supabase không bao giờ làm treo UI hoặc quay vô tận
const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number = 6000, fallback: T): Promise<T> => {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[Supabase Timeout] Truy vấn vượt quá ${timeoutMs}ms, tự động chuyển về dữ liệu dự phòng`);
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    console.warn("[Supabase Catch Error]", err);
    return fallback;
  }
};

export const isDatabaseConnected = (): boolean => {
    return !!supabase;
};

const handleSupabaseError = (error: any, context: string) => {
    if (error) {
        console.error(`LỖI SUPABASE [${context}]:`, error);
        throw new Error(`${context} thất bại: ${error.message || JSON.stringify(error)}`);
    }
};

// --- Results ---
export const getResultsMetadataPage = async (page: number, pageSize: number = 50, quizId?: string, search?: string): Promise<{ data: Result[], total: number }> => {
  if (!supabase) return { data: [], total: 0 };
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase.from('results')
      .select('id, quiz_id, student_id, data', { count: 'exact' })
      .order('id', { ascending: false })
      .range(from, to);
      
    if (quizId && quizId !== 'all') {
      query = query.eq('quiz_id', quizId);
    }

    if (search) {
      // Tìm kiếm theo tên học sinh hoặc mã học sinh lưu trong cột data (JSONB)
      query = query.or(`data->>studentName.ilike.%${search}%,data->>studentCode.ilike.%${search}%`);
    }
    
    const { data, count, error } = await query;
    if (error) throw error;
    
    const results = data ? data.map((row: any) => ({
      ...(row.data as Result),
      id: row.id,
      quizId: row.quiz_id,
      studentId: row.student_id
    })) : [];

    return { data: results, total: count || 0 };
  } catch (e) {
    console.error("Lỗi getResultsMetadataPage:", e);
    return { data: [], total: 0 };
  }
};

export const getResultsMetadata = async (quizId?: string, maxRecords: number = 10000, forceRefresh: boolean = false): Promise<Result[]> => {
  if (!supabase) return [];
  const cacheKey = `results_meta_${quizId || 'all'}`;
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }
  try {
      let allData: any[] = [];
      let from = 0;
      const step = 1000;
      let hasMore = true;

      while (hasMore && allData.length < maxRecords) {
          let query = supabase.from('results')
            .select('*')
            .order('id', { ascending: false })
            .range(from, from + step - 1);
            
          if (quizId && quizId !== 'all') {
            query = query.or(`quiz_id.eq.${quizId},data->>quizId.eq.${quizId}`);
          }
          
          const { data, error } = await query;
          if (error) {
            console.warn("Lỗi fetch results meta batch:", error);
            hasMore = false;
            break;
          }
          
          if (data && data.length > 0) {
              allData = [...allData, ...data];
              from += step;
              if (data.length < step) hasMore = false;
          } else {
              hasMore = false;
          }
      }
      
      const mapped = allData.map((row: any) => {
          const res = (row.data && typeof row.data === 'object') ? row.data : (row || {});
          return {
              ...res,
              id: row.id || res.id,
              quizId: row.quiz_id || res.quizId,
              studentId: row.student_id || res.studentId
          } as Result;
      });
      memoryCache[cacheKey] = { data: mapped, expires: now + CACHE_TTL };
      return mapped;
  } catch (e) {
      console.error("Lỗi getResultsMetadata:", e);
      return [];
  }
};

export const getResultsCount = async (quizId?: string): Promise<number> => {
  if (!supabase) return 0;
  let query = supabase.from('results').select('*', { count: 'exact', head: true });
  if (quizId && quizId !== 'all') query = query.eq('quiz_id', quizId);
  const { count, error } = await query;
  return error ? 0 : (count || 0);
};

export const getResults = async (quizId?: string, maxRecords: number = 5000): Promise<Result[]> => {
  if (!supabase) return [];
  try {
      let allData: any[] = [];
      let from = 0;
      const step = 1000;
      let hasMore = true;

      while (hasMore && allData.length < maxRecords) {
          let query = supabase.from('results')
            .select('data')
            .order('id', { ascending: false })
            .range(from, from + step - 1);
            
          if (quizId && quizId !== 'all') {
            query = query.eq('quiz_id', quizId);
          }
          
          const { data, error } = await query;
          if (error) throw error;
          
          if (data && data.length > 0) {
              allData = [...allData, ...data];
              from += step;
              if (data.length < step) hasMore = false;
          } else {
              hasMore = false;
          }
      }
      return allData.map((row: any) => row.data as Result);
  } catch (e) {
      return [];
  }
};

export const getResultsForStudent = async (studentId: string, studentCode?: string, forceRefresh: boolean = false): Promise<Result[]> => {
  if (!supabase) return [];
  const cacheKey = `student_results_${studentId}_${studentCode || 'na'}`;
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }
  let query = supabase.from('results')
    .select('data')
    .order('id', { ascending: false })
    .limit(500); // Lấy 500 bài gần nhất của học sinh này
    
  if (studentCode && studentCode !== 'N/A') {
    const code = studentCode.trim().toUpperCase();
    query = query.or(`student_id.eq.${studentId},data->>studentCode.eq.${code}`);
  } else {
    query = query.eq('student_id', studentId);
  }
  const { data, error } = await query;
  if (error) return [];
  const result = data.map((row: any) => row.data as Result);
  memoryCache[cacheKey] = { data: result, expires: now + CACHE_TTL };
  return result;
};

export const verifyResultExists = async (id: string): Promise<boolean> => {
    if (!supabase) return false;
    const { data } = await supabase.from('results').select('id').eq('id', id).maybeSingle();
    return !!data;
};

export const getResultById = async (id: string): Promise<Result | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from('results').select('data').eq('id', id).single();
    if (error || !data) return null;
    return data.data as Result;
};

export const saveResult = async (result: Result): Promise<void> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  invalidateCache('student_results');
  invalidateCache('published_results');
  const payload = { id: result.id, quiz_id: result.quizId, student_id: result.studentId, data: result };
  const { error } = await supabase.from('results').insert(payload);
  handleSupabaseError(error, "Lưu kết quả thi");
};

export const deleteResult = async (id: string): Promise<void> => {
    if (supabase) {
        invalidateCache('student_results');
        invalidateCache('published_results');
        const { error } = await supabase.from('results').delete().eq('id', id);
        handleSupabaseError(error, "Xóa kết quả");
    }
};

export const updateResultCode = async (id: string, code: string): Promise<void> => {
    if (!supabase) return;
    const { data } = await supabase.from('results').select('data').eq('id', id).single();
    if (!data) return;
    const resData = { ...data.data, studentCode: code.trim().toUpperCase() };
    await supabase.from('results').update({ data: resData }).eq('id', id);
};

// --- Users ---
export const getUsersPage = async (page: number, pageSize: number = 50, search?: string): Promise<{ data: User[], total: number }> => {
  if (!supabase) return { data: [], total: 0 };
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase.from('users')
      .select('*', { count: 'exact' })
      .order('id', { ascending: false })
      .range(from, to);
    
    if (search) {
      // Lọc role student mặc định cho dashboard
      query = query.or(`data->>fullName.ilike.%${search}%,data->>studentCode.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;
    const users = data ? data.map((row: any) => ({ ...row.data, id: row.id } as User)) : [];
    return { data: users, total: count || 0 };
  } catch (e) {
    console.error("Lỗi getUsersPage:", e);
    return { data: [], total: 0 };
  }
};

export const getUsers = async (forceRefresh: boolean = false): Promise<User[]> => {
  if (!supabase) return [];
  const cacheKey = 'users_all';
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }
  try {
    let allUsers: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase.from('users')
            .select('*')
            .range(from, from + step - 1);
        
        if (error) throw error;
        if (data && data.length > 0) {
            allUsers = [...allUsers, ...data];
            from += step;
            if (data.length < step) hasMore = false;
        } else {
            hasMore = false;
        }
    }
    const result = allUsers.map((row: any) => ({ ...row.data, id: row.id } as User));
    memoryCache[cacheKey] = { data: result, expires: now + CACHE_TTL };
    return result;
  } catch (e) {
    console.error("Lỗi getUsers:", e);
    return [];
  }
};

export const saveUser = async (user: User): Promise<void> => {
  invalidateCache('users_all');
  if (!supabase) throw new Error("Mất kết nối Database Cloud");
  const payload = { id: user.id, username: user.username.toLowerCase().trim(), data: user };
  await supabase.from('users').upsert(payload);
};

export const saveUsersBatch = async (users: User[]): Promise<void> => {
  invalidateCache('users_all');
  if (!supabase) throw new Error("Mất kết nối Database Cloud");
  if (users.length === 0) return;
  const payloads = users.map(user => ({
    id: user.id,
    username: user.username.toLowerCase().trim(),
    data: user
  }));
  const { error } = await supabase.from('users').upsert(payloads);
  handleSupabaseError(error, "Lưu danh sách học sinh");
};

export const addPointsToUser = async (userId: string, points: number): Promise<void> => {
    if (!supabase) return;
    const { data } = await supabase.from('users').select('data').eq('id', userId).single();
    if (data) {
      const userData = { ...data.data, points: (data.data.points || 0) + points };
      await supabase.from('users').update({ data: userData }).eq('id', userId);
    }
};

export const findUserByStudentCode = async (code: string): Promise<User | undefined> => {
  if (!supabase) return undefined;
  console.log("Supabase: Đang tìm User qua mã HS:", code.trim().toUpperCase());
  const { data, error } = await supabase.from('users').select('data').filter('data->>studentCode', 'eq', code.trim().toUpperCase()).maybeSingle();
  if (error) {
    console.error("Lỗi Supabase khi tìm mã HS:", error);
    return undefined;
  }
  console.log("Kết quả tìm kiếm User:", data);
  return data?.data as User;
};

export const findUser = async (username: string): Promise<User | undefined> => {
  if (!supabase) return undefined;
  console.log("Supabase: Đang tìm User qua username:", username.trim().toLowerCase());
  const { data, error } = await supabase.from('users').select('data').eq('username', username.trim().toLowerCase()).maybeSingle();
  if (error) {
    console.error("Lỗi Supabase khi tìm username:", error);
    return undefined;
  }
  console.log("Kết quả tìm kiếm User:", data);
  return data?.data as User;
};

export const testSupabaseConnection = async (): Promise<{success: boolean, message: string}> => {
    if (!supabase) return { success: false, message: "Supabase client not initialized" };
    console.log("Đang kiểm tra kết nối tới:", SUPABASE_URL);
    try {
        const { data, error } = await supabase.from('users').select('id').limit(1);
        if (error) {
            console.error("Lỗi PostgREST:", error);
            return { success: false, message: `Lỗi kết nối (${SUPABASE_URL}): ${error.message || JSON.stringify(error)}` };
        }
        return { success: true, message: `Kết nối OK. Tìm thấy ${data?.length || 0} bản ghi.` };
    } catch (e: any) {
        console.error("Lỗi Exception kết nối:", e);
        return { success: false, message: `Lỗi kết nối ngoại lệ: ${e.message}` };
    }
};

export const deleteUser = async (id: string): Promise<void> => {
  if (supabase) {
      // 1. Xóa tất cả các kết quả thi của người dùng này trước để tránh dữ liệu mồ côi
      const { error: resultsError } = await supabase.from('results').delete().eq('student_id', id);
      if (resultsError) {
          console.warn("Cảnh báo: Không thể xóa sạch kết quả thi của người dùng, nhưng vẫn tiến hành xóa tài khoản.", resultsError);
      }

      // 2. Xóa thông tin người dùng
      const { error } = await supabase.from('users').delete().eq('id', id);
      handleSupabaseError(error, "Xóa người dùng");
  }
};

export const changePassword = async (userId: string, newPassword: string): Promise<boolean> => {
    if (!supabase) return false;
    const { data } = await supabase.from('users').select('data').eq('id', userId).single();
    if (!data) return false;
    const userData = { ...data.data, password: newPassword };
    const { error } = await supabase.from('users').update({ data: userData }).eq('id', userId);
    return !error;
};

// Định nghĩa các trường Metadata của Đề thi (chỉ lấy thông tin hiển thị, KHÔNG LẤY cột câu hỏi để giảm 98% băng thông)
const QUIZ_METADATA_PROJECTION = `
    id,
    grade,
    data->title,
    data->description,
    data->type,
    data->academicYear,
    data->category,
    data->folderId,
    data->folderName,
    data->startTime,
    data->endTime,
    data->durationMinutes,
    data->questionCount,
    data->attemptCount,
    data->createdAt,
    data->isPublished,
    data->isMonitored,
    data->isUnlisted,
    data->targetType,
    data->assignedClassIds,
    data->assignedClasses,
    data->maxAttempts,
    data->allowReview,
    data->orderIndex
`;

const mapRowToQuizMeta = (row: any): Quiz => {
    const d = (row && row.data && typeof row.data === 'object') ? row.data : (row || {});
    return {
        id: String(row.id || d.id || ''),
        grade: String(d.grade || row.grade || '12') as Grade,
        title: d.title || row.title || 'Đề thi',
        description: d.description || row.description || '',
        type: d.type || row.type || 'practice',
        academicYear: d.academicYear || row.academicYear || '',
        category: d.category || row.category || '',
        folderId: d.folderId || row.folderId || undefined,
        folderName: d.folderName || row.folderName || undefined,
        startTime: d.startTime || row.startTime || '',
        endTime: d.endTime || row.endTime || '',
        durationMinutes: typeof d.durationMinutes === 'number' ? d.durationMinutes : (parseInt(d.durationMinutes || row.durationMinutes) || 45),
        questionCount: typeof d.questionCount === 'number' ? d.questionCount : (typeof row.questionCount === 'number' ? row.questionCount : (parseInt(d.questionCount || row.questionCount) || (Array.isArray(d.questions) ? d.questions.length : 0))),
        attemptCount: typeof d.attemptCount === 'number' ? d.attemptCount : (parseInt(d.attemptCount || row.attemptCount) || 0),
        createdAt: d.createdAt || row.createdAt || new Date().toISOString(),
        isPublished: d.isPublished === true || d.isPublished === 'true' || row.isPublished === true || row.isPublished === 'true',
        isMonitored: d.isMonitored === true || d.isMonitored === 'true' || row.isMonitored === true || row.isMonitored === 'true',
        isUnlisted: d.isUnlisted === true || d.isUnlisted === 'true' || row.isUnlisted === true || row.isUnlisted === 'true',
        targetType: d.targetType || row.targetType || 'all',
        assignedClassIds: Array.isArray(d.assignedClassIds) ? d.assignedClassIds : (Array.isArray(row.assignedClassIds) ? row.assignedClassIds : []),
        assignedClasses: Array.isArray(d.assignedClasses) ? d.assignedClasses : (Array.isArray(row.assignedClasses) ? row.assignedClasses : []),
        maxAttempts: typeof d.maxAttempts === 'number' ? d.maxAttempts : (typeof row.maxAttempts === 'number' ? row.maxAttempts : 2),
        allowReview: d.allowReview ?? row.allowReview ?? true,
        orderIndex: typeof d.orderIndex === 'number' ? d.orderIndex : (typeof row.orderIndex === 'number' ? row.orderIndex : 0),
        questions: [] // Tuyệt đối không tải mảng câu hỏi ở metadata để tiết kiệm bộ nhớ và băng thông
    };
};

// --- Quizzes ---
export const getQuizzesMetadataPage = async (page: number, pageSize: number = 20, grade?: Grade): Promise<{ data: Quiz[], total: number }> => {
  if (!supabase) return { data: [], total: 0 };
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase.from('quizzes')
      .select('*', { count: 'exact' })
      .order('id', { ascending: false })
      .range(from, to);
    
    const { data, count, error } = await query;
    if (error) throw error;
    
    let quizzes: Quiz[] = data ? data.map(mapRowToQuizMeta) : [];
    if (grade && grade !== 'all') {
      quizzes = quizzes.filter((q: Quiz) => !q.grade || q.grade === 'all' || q.grade === grade);
    }
    return { data: quizzes, total: count || 0 };
  } catch (e) {
    console.error("Lỗi getQuizzesMetadataPage:", e);
    return { data: [], total: 0 };
  }
};

// Cache in-memory 10 phút để giảm triệt để băng thông và số lượng request
const memoryCache: { [key: string]: { data: any; expires: number } } = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 phút (600.000 ms)

export const invalidateCache = (prefix?: string) => {
  if (!prefix) {
    Object.keys(memoryCache).forEach(k => delete memoryCache[k]);
  } else {
    Object.keys(memoryCache).filter(k => k.startsWith(prefix)).forEach(k => delete memoryCache[k]);
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (!prefix) {
        Object.keys(sessionStorage).filter(k => k.startsWith('quizzes_') || k.startsWith('quiz_')).forEach(k => sessionStorage.removeItem(k));
      } else {
        Object.keys(sessionStorage).filter(k => k.startsWith(prefix)).forEach(k => sessionStorage.removeItem(k));
      }
    }
  } catch (e) {}
};

// Cập nhật trực tiếp 1 đề thi vào Cache Memory mà không làm mất bộ đệm 70 đề khác
export const updateQuizInCache = (updatedQuiz: Quiz) => {
  const metaItem: Quiz = {
    ...updatedQuiz,
    questionCount: updatedQuiz.questions ? updatedQuiz.questions.length : (updatedQuiz.questionCount || 0),
    questions: []
  };

  quizDetailCache.set(updatedQuiz.id, updatedQuiz);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`quiz_detail_${updatedQuiz.id}`, JSON.stringify(updatedQuiz));
    }
  } catch (e) {}

  Object.keys(memoryCache).forEach(k => {
    if (k.startsWith('quizzes_meta_')) {
      const list = memoryCache[k].data as Quiz[];
      if (Array.isArray(list)) {
        // Lọc bỏ đề cũ nếu có, sau đó thêm đề mới lên đầu (tạo mảng mới tránh mutation lỗi)
        memoryCache[k].data = [metaItem, ...list.filter(q => q.id !== updatedQuiz.id)];
      }
    } else if (k.startsWith('quizzes_full_')) {
      const list = memoryCache[k].data as Quiz[];
      if (Array.isArray(list)) {
        // Lọc bỏ đề cũ nếu có, sau đó thêm đề mới lên đầu
        memoryCache[k].data = [updatedQuiz, ...list.filter(q => q.id !== updatedQuiz.id)];
      }
    }
  });
};

// Xóa sạch tất cả bộ nhớ đệm (Memory, localStorage, sessionStorage) để tải dữ liệu mới nhất 100% từ Server
export const clearAllLocalCaches = () => {
  for (const k of Object.keys(memoryCache)) {
    delete memoryCache[k];
  }
  quizDetailCache.clear();

  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('quizzes_') || k.startsWith('chapters_') || k.startsWith('quiz_folders_') || k.startsWith('eduquiz_admin_quiz_filters') || k.startsWith('results_') || k.startsWith('classes_') || k.startsWith('users_'))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  } catch (e) {}
};

// Chỉ xóa cache khi người dùng bấm nút "Xóa Cache & Đồng bộ"
// try {
//   clearAllLocalCaches();
// } catch (e) {}

// Xóa 1 đề thi khỏi Cache Memory trực tiếp
export const removeQuizFromCache = (quizId: string) => {
  quizDetailCache.delete(quizId);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(`quiz_detail_${quizId}`);
    }
  } catch (e) {}
  Object.keys(memoryCache).forEach(k => {
    if (k.startsWith('quizzes_meta_') || k.startsWith('quizzes_full_')) {
      const list = memoryCache[k].data as Quiz[];
      if (Array.isArray(list)) {
        memoryCache[k].data = list.filter(q => q.id !== quizId);
      }
    }
  });
};

export const getQuizzesMetadata = async (grade?: Grade, forceRefresh: boolean = false): Promise<Quiz[]> => {
  if (!supabase) return [];
  const cacheKey = `quizzes_meta_${grade || 'all'}`;
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }

  const fetchPromise = async (): Promise<Quiz[]> => {
    let allQuizzes: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        let query = supabase.from('quizzes')
            .select('*')
            .range(from, from + step - 1);
            
        if (grade && grade !== 'all') {
            query = query.or(`grade.eq.${grade},grade.eq.all,grade.is.null`);
        }

        try {
          query = query.order('id', { ascending: false });
        } catch {}
        
        const { data, error } = await query;
        if (error) {
            console.warn("Lỗi query getQuizzesMetadata:", error);
            const fallbackQuery = await supabase.from('quizzes').select('*');
            if (fallbackQuery.data && fallbackQuery.data.length > 0) {
              allQuizzes = fallbackQuery.data;
            }
            hasMore = false;
            break;
        }
        
        if (data && data.length > 0) {
            allQuizzes = [...allQuizzes, ...data];
            from += step;
            if (data.length < step) hasMore = false;
        } else {
            hasMore = false;
        }
    }
    
    let mapped: Quiz[] = allQuizzes.map(mapRowToQuizMeta);

    if (grade && grade !== 'all') {
        mapped = mapped.filter((q: Quiz) => !q.grade || q.grade === 'all' || q.grade === grade);
    }

    const cachePayload = { data: mapped, expires: Date.now() + CACHE_TTL };
    memoryCache[cacheKey] = cachePayload;
    return mapped;
  };

  const cached = memoryCache[cacheKey]?.data || [];
  return withTimeout(fetchPromise(), 6000, cached);
};

export const getQuizzes = async (grade?: Grade, forceRefresh: boolean = false): Promise<Quiz[]> => {
  if (!supabase) return [];
  const cacheKey = `quizzes_full_${grade || 'all'}`;
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }
  try {
    let allQuizzes: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        let query = supabase.from('quizzes')
            .select('data')
            .order('id', { ascending: false })
            .range(from, from + step - 1);
            
        if (grade && grade !== 'all') {
            query = query.or(`grade.eq.${grade},grade.eq.all`);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        if (data && data.length > 0) {
            allQuizzes = [...allQuizzes, ...data];
            from += step;
            if (data.length < step) hasMore = false;
        } else {
            hasMore = false;
        }
    }
    const result = allQuizzes.map((row: any) => {
      const q = row.data as Quiz;
      quizDetailCache.set(q.id, q);
      return q;
    });
    memoryCache[cacheKey] = { data: result, expires: now + CACHE_TTL };
    return result;
  } catch (e) {
    return [];
  }
};

const quizDetailCache = new Map<string, Quiz>();

export const getQuizById = async (id: string, forceRefresh: boolean = false): Promise<Quiz | null> => {
    if (!supabase) return null;
    if (!forceRefresh && quizDetailCache.has(id)) {
        return quizDetailCache.get(id)!;
    }

    // Kiểm tra sessionStorage để tải đề tức thì không tốn băng thông mạng
    try {
        if (!forceRefresh && typeof sessionStorage !== 'undefined') {
            const cached = sessionStorage.getItem(`quiz_detail_${id}`);
            if (cached) {
                const parsed = JSON.parse(cached) as Quiz;
                quizDetailCache.set(id, parsed);
                return parsed;
            }
        }
    } catch (e) {}

    const { data, error } = await supabase.from('quizzes').select('data').eq('id', id).single();
    if (error || !data) return null;
    const quiz = data.data as Quiz;
    quizDetailCache.set(id, quiz);

    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(`quiz_detail_${id}`, JSON.stringify(quiz));
        }
    } catch (e) {}

    return quiz;
};

export const saveQuiz = async (quiz: Quiz): Promise<void> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  const enrichedQuiz = { 
    ...quiz, 
    questionCount: quiz.questions.length,
    isSyncedToBank: quiz.isSyncedToBank ?? false 
  };
  updateQuizInCache(enrichedQuiz);
  const { error } = await supabase.from('quizzes').insert({ id: quiz.id, grade: quiz.grade, data: enrichedQuiz });
  handleSupabaseError(error, "Lưu đề thi mới");
};

export const updateQuiz = async (enrichedQuiz: Quiz): Promise<void> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  const quiz = { ...enrichedQuiz, questionCount: enrichedQuiz.questions.length };
  updateQuizInCache(quiz);
  const { error } = await supabase.from('quizzes').update({ data: quiz, grade: enrichedQuiz.grade }).eq('id', enrichedQuiz.id);
  handleSupabaseError(error, "Cập nhật đề thi");
};

// Helper tính toán Niên khóa / Năm học hiện hành theo lịch Việt Nam (tháng 9 bắt đầu năm học mới)
// Quy tắc: Từ 01/09 đến 31/08 năm sau:
// - Từ 01/09/2025 đến 31/08/2026 => Niên học 2025-2026
// - Qua ngày 01/09/2026 đến 31/08/2027 => Niên học 2026-2027
export const getCurrentAcademicYear = (date: Date = new Date()): string => {
  const currentYear = date.getFullYear();
  const currentMonth = date.getMonth() + 1; // 1 (Tháng 1) đến 12 (Tháng 12)
  if (currentMonth >= 9) {
    return `${currentYear}-${currentYear + 1}`;
  } else {
    return `${currentYear - 1}-${currentYear}`;
  }
};

// Cập nhật nhanh Niên khóa / Năm học cho 1 đề thi
export const updateQuizAcademicYear = async (
  quizId: string,
  academicYear: string
): Promise<void> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  const { data, error } = await supabase.from('quizzes').select('id, grade, data').eq('id', quizId).single();
  if (error || !data) throw new Error("Không tìm thấy đề thi trên hệ thống");
  const currentQuiz = data.data as Quiz;
  const updatedQuiz: Quiz = {
    ...currentQuiz,
    academicYear
  };
  updateQuizInCache(updatedQuiz);
  const { error: updateErr } = await supabase.from('quizzes').update({
    data: updatedQuiz,
    grade: data.grade
  }).eq('id', quizId);
  handleSupabaseError(updateErr, "Cập nhật năm học cho đề thi");
};

// Cập nhật hàng loạt Niên khóa cho nhiều đề thi
export const batchUpdateQuizAcademicYear = async (
  quizIds: string[],
  academicYear: string
): Promise<number> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  if (quizIds.length === 0) return 0;
  const { data, error } = await supabase.from('quizzes').select('id, grade, data').in('id', quizIds);
  if (error || !data) throw new Error("Lỗi khi tải danh sách đề thi");

  let count = 0;
  for (const row of data) {
    const currentQuiz = row.data as Quiz;
    const updatedQuiz: Quiz = {
      ...currentQuiz,
      academicYear
    };
    updateQuizInCache(updatedQuiz);
    const { error: updateErr } = await supabase.from('quizzes').update({
      data: updatedQuiz,
      grade: row.grade
    }).eq('id', row.id);
    if (!updateErr) count++;
  }
  return count;
};

// Gán nhanh phòng / lớp cho một đề thi
export const updateQuizTarget = async (
  quizId: string, 
  targetType: 'all' | 'classes', 
  assignedClassIds: string[]
): Promise<void> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  const { data, error } = await supabase.from('quizzes').select('id, grade, data').eq('id', quizId).single();
  if (error || !data) throw new Error("Không tìm thấy đề thi trên hệ thống");
  const currentQuiz = data.data as Quiz;
  const updatedQuiz: Quiz = {
    ...currentQuiz,
    targetType,
    assignedClassIds
  };
  updateQuizInCache(updatedQuiz);
  const { error: updateErr } = await supabase.from('quizzes').update({
    data: updatedQuiz,
    grade: data.grade
  }).eq('id', quizId);
  handleSupabaseError(updateErr, "Gán phòng/lớp cho đề thi");
};

// Cập nhật nhanh quyền xem đáp án chi tiết
export const updateQuizAllowReview = async (
  quizId: string, 
  allowReview: boolean
): Promise<void> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  const { data, error } = await supabase.from('quizzes').select('id, grade, data').eq('id', quizId).single();
  if (error || !data) throw new Error("Không tìm thấy đề thi trên hệ thống");
  const currentQuiz = data.data as Quiz;
  const updatedQuiz: Quiz = {
    ...currentQuiz,
    allowReview
  };
  updateQuizInCache(updatedQuiz);
  const { error: updateErr } = await supabase.from('quizzes').update({
    data: updatedQuiz,
    grade: data.grade
  }).eq('id', quizId);
  handleSupabaseError(updateErr, "Cập nhật quyền xem đáp án chi tiết");
};

// Gán nhanh phòng / lớp hàng loạt cho nhiều đề thi (ví dụ chuyển hàng loạt đề cũ vào phòng tạm)
export const batchUpdateQuizTarget = async (
  quizIds: string[],
  targetType: 'all' | 'classes',
  assignedClassIds: string[]
): Promise<number> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  if (quizIds.length === 0) return 0;
  const { data, error } = await supabase.from('quizzes').select('id, grade, data').in('id', quizIds);
  if (error || !data) throw new Error("Lỗi khi tải danh sách đề thi");

  let count = 0;
  for (const row of data) {
    const currentQuiz = row.data as Quiz;
    const updatedQuiz: Quiz = {
      ...currentQuiz,
      targetType,
      assignedClassIds
    };
    updateQuizInCache(updatedQuiz);
    const { error: updateErr } = await supabase.from('quizzes').update({
      data: updatedQuiz,
      grade: row.grade
    }).eq('id', row.id);
    if (!updateErr) count++;
  }
  return count;
};

export const deleteQuiz = async (id: string): Promise<void> => {
  if (supabase) {
      removeQuizFromCache(id);
      const { error } = await supabase.from('quizzes').delete().eq('id', id);
      handleSupabaseError(error, "Xóa đề thi");
  }
};

// CÔNG CỤ ĐỒNG BỘ: Quét lại toàn bộ đề thi để cập nhật số câu chính xác
export const syncAllQuizzesMetadata = async (): Promise<number> => {
  if (!supabase) return 0;
  try {
    const { data: allQuizzes, error } = await supabase.from('quizzes').select('*');
    if (error || !allQuizzes) return 0;
    
    let count = 0;
    for (const row of allQuizzes) {
      const quiz = row.data as Quiz;
      const questionCount = quiz.questions ? quiz.questions.length : 0;
      const updatedQuiz = { ...quiz, questionCount };
      
      await supabase.from('quizzes').update({ 
          data: updatedQuiz, 
          grade: quiz.grade 
      }).eq('id', row.id);
      count++;
    }
    return count;
  } catch (e) {
    console.error("Lỗi đồng bộ Metadata:", e);
    return 0;
  }
};

// --- Chapters ---
export const getChapters = async (forceRefresh: boolean = false): Promise<Chapter[]> => {
  if (!supabase) return [];
  const cacheKey = 'chapters_all';
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }
  
  const fetchPromise = async (): Promise<Chapter[]> => {
    const { data } = await supabase.from('chapters').select('data');
    const result = data ? data.map((row: any) => row.data as Chapter).sort((a: Chapter, b: Chapter) => a.order - b.order) : [];
    memoryCache[cacheKey] = { data: result, expires: Date.now() + CACHE_TTL };
    return result;
  };

  const cached = memoryCache[cacheKey]?.data || [];
  return withTimeout(fetchPromise(), 5000, cached);
};

export const saveChapter = async (c: Chapter): Promise<void> => {
  invalidateCache('chapters_all');
  if (supabase) await supabase.from('chapters').insert({ id: c.id, grade: c.grade, data: c });
};

export const deleteChapter = async (id: string): Promise<void> => {
  invalidateCache('chapters_all');
  if (supabase) await supabase.from('chapters').delete().eq('id', id);
};

// --- Quiz Folders (Thư mục đề thi con trong từng Chương) ---
// Dữ liệu được lưu trữ 100% trên Supabase Server (Single Source of Truth)

// Tự động dọn dẹp bộ nhớ đệm ổ cứng cũ nếu có
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('eduquiz_quiz_folders_v1');
  }
} catch (e) {}

export const getQuizFolders = async (grade?: Grade, forceRefresh: boolean = false): Promise<QuizFolder[]> => {
  const cacheKey = `quiz_folders_${grade || 'all'}`;
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }

  const fetchPromise = async (): Promise<QuizFolder[]> => {
    let dbFolders: QuizFolder[] = [];
    if (supabase) {
      try {
        let query = supabase.from('quiz_folders').select('data');
        if (grade && grade !== 'all') {
          query = query.or(`grade.eq.${grade},grade.eq.all`);
        }
        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          dbFolders = data.map((row: any) => row.data as QuizFolder);
        }
      } catch (e) {
        console.warn("Chưa đọc được bảng quiz_folders trên Supabase:", e);
      }
    }

    const folderMap = new Map<string, QuizFolder>();
    dbFolders.forEach(f => {
      if (f && f.id) folderMap.set(f.id, f);
    });

    let merged = Array.from(folderMap.values());
    if (grade && grade !== 'all') {
      merged = merged.filter(f => !f.grade || f.grade === 'all' || f.grade === grade);
    }

    merged.sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
    memoryCache[cacheKey] = { data: merged, expires: Date.now() + CACHE_TTL };
    return merged;
  };

  const cached = memoryCache[cacheKey]?.data || [];
  return withTimeout(fetchPromise(), 5000, cached);
};

export const saveQuizFolder = async (folder: QuizFolder): Promise<void> => {
  invalidateCache('quiz_folders_');
  // Lưu 100% trực tiếp lên Supabase Database
  if (!supabase) throw new Error("Mất kết nối với cơ sở dữ liệu Supabase");

  const { error } = await supabase.from('quiz_folders').upsert({
    id: folder.id,
    grade: folder.grade || 'all',
    data: folder
  });

  if (error) {
    console.error("Lỗi lưu quiz_folder lên Supabase:", error);
    throw new Error(`Không thể lưu thư mục lên máy chủ: ${error.message || 'Lỗi không xác định'}. Hãy chắc chắn bảng quiz_folders đã được tạo trên Supabase.`);
  }
};

export const deleteQuizFolder = async (folderId: string): Promise<void> => {
  invalidateCache('quiz_folders_');
  invalidateCache('quizzes_meta_');
  invalidateCache('quizzes_full_');
  
  if (!supabase) throw new Error("Mất kết nối với cơ sở dữ liệu Supabase");

  // 1. Xóa thư mục trên Supabase
  const { error } = await supabase.from('quiz_folders').delete().eq('id', folderId);
  if (error) {
    console.warn("Lỗi xóa folder trên Supabase:", error);
  }

  // 2. Trả các đề thi thuộc folder này về trạng thái chưa phân thư mục trên Supabase
  try {
    const { data: matchedRows } = await supabase
      .from('quizzes')
      .select('id, grade, data');

    if (matchedRows && matchedRows.length > 0) {
      for (const row of matchedRows) {
        const q = row.data as Quiz;
        if (q && q.folderId === folderId) {
          const updatedQuiz: Quiz = {
            ...q,
            folderId: undefined,
            folderName: undefined
          };
          updateQuizInCache(updatedQuiz);
          await supabase.from('quizzes').update({
            data: updatedQuiz,
            grade: row.grade || q.grade
          }).eq('id', row.id);
        }
      }
    }
  } catch (e) {
    console.warn("Lỗi hoàn trả đề thi về vùng chưa phân:", e);
  }
};

// Di chuyển nhanh đề thi vào một thư mục
export const updateQuizFolderAssignment = async (
  quizId: string,
  folderId?: string,
  folderName?: string,
  chapterName?: string
): Promise<void> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  const { data, error } = await supabase.from('quizzes').select('id, grade, data').eq('id', quizId).single();
  if (error || !data) throw new Error("Không tìm thấy đề thi");
  const currentQuiz = data.data as Quiz;
  const updatedQuiz: Quiz = {
    ...currentQuiz,
    folderId: folderId || undefined,
    folderName: folderName || undefined,
    category: chapterName || currentQuiz.category
  };
  updateQuizInCache(updatedQuiz);
  const { error: updateErr } = await supabase.from('quizzes').update({
    data: updatedQuiz,
    grade: data.grade
  }).eq('id', quizId);
  handleSupabaseError(updateErr, "Di chuyển đề thi vào thư mục");
};

// Di chuyển hàng loạt đề thi vào thư mục
export const batchMoveQuizzesToFolder = async (
  quizIds: string[],
  folderId?: string,
  folderName?: string,
  chapterName?: string
): Promise<number> => {
  if (!supabase) throw new Error("Mất kết nối Database");
  if (quizIds.length === 0) return 0;
  const { data, error } = await supabase.from('quizzes').select('id, grade, data').in('id', quizIds);
  if (error || !data) throw new Error("Lỗi khi nạp danh sách đề thi");

  let count = 0;
  for (const row of data) {
    const currentQuiz = row.data as Quiz;
    const updatedQuiz: Quiz = {
      ...currentQuiz,
      folderId: folderId || undefined,
      folderName: folderName || undefined,
      category: chapterName || currentQuiz.category
    };
    updateQuizInCache(updatedQuiz);
    const { error: updateErr } = await supabase.from('quizzes').update({
      data: updatedQuiz,
      grade: row.grade
    }).eq('id', row.id);
    if (!updateErr) count++;
  }
  return count;
};

// --- Classroom & Academic Year Management ---
export const getClasses = async (forceRefresh: boolean = false): Promise<ClassRoom[]> => {
  const cacheKey = 'classes_all';
  const now = Date.now();
  if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
    return memoryCache[cacheKey].data;
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from('classes').select('*');
      if (!error && data && data.length > 0) {
        const classes = data.map((row: any) => ({
          ...(row.data || {}),
          id: row.id,
          name: row.name || (row.data && row.data.name) || '',
          academicYear: row.academic_year || (row.data && row.data.academicYear) || '',
          grade: row.grade || (row.data && row.data.grade) || '12',
          description: row.description || (row.data && row.data.description) || ''
        } as ClassRoom));
        
        // Cache to memory and localStorage for fast read
        memoryCache[cacheKey] = { data: classes, expires: now + CACHE_TTL };
        try {
          localStorage.setItem('eduquiz_classes_cache', JSON.stringify(classes));
        } catch (e) {}
        return classes;
      }
    } catch (e) {
      console.warn("Chưa có bảng classes trên Supabase hoặc lỗi đọc, fallback sang cache/local:", e);
    }
  }

  // Fallback to localStorage
  try {
    const local = localStorage.getItem('eduquiz_classes_cache');
    if (local) {
      const parsed = JSON.parse(local);
      memoryCache[cacheKey] = { data: parsed, expires: now + CACHE_TTL };
      return parsed;
    }
  } catch (e) {}
  return [];
};

export const saveClass = async (c: ClassRoom): Promise<void> => {
  invalidateCache('classes_all');
  // Update local cache first
  try {
    const list = await getClasses();
    const idx = list.findIndex(item => item.id === c.id);
    if (idx >= 0) list[idx] = c;
    else list.push(c);
    localStorage.setItem('eduquiz_classes_cache', JSON.stringify(list));
  } catch (e) {}

  if (supabase) {
    try {
      await supabase.from('classes').upsert({ 
        id: c.id, 
        name: c.name,
        academic_year: c.academicYear,
        grade: c.grade,
        data: c 
      });
    } catch (e) {
      console.warn("Lưu classes vào Supabase (bảng có thể chưa tạo):", e);
    }
  }
};

export const saveClassesBatch = async (classesList: ClassRoom[]): Promise<void> => {
  invalidateCache('classes_all');
  if (classesList.length === 0) return;
  try {
    localStorage.setItem('eduquiz_classes_cache', JSON.stringify(classesList));
  } catch (e) {}

  if (supabase) {
    try {
      const payload = classesList.map(c => ({
        id: c.id,
        name: c.name,
        academic_year: c.academicYear,
        grade: c.grade,
        data: c
      }));
      await supabase.from('classes').upsert(payload);
    } catch (e) {
      console.warn("Lưu batch classes vào Supabase:", e);
    }
  }
};

export const deleteClass = async (id: string): Promise<void> => {
  invalidateCache('classes_all');
  try {
    const list = await getClasses();
    const updated = list.filter(item => item.id !== id);
    localStorage.setItem('eduquiz_classes_cache', JSON.stringify(updated));
  } catch (e) {}

  if (supabase) {
    try {
      await supabase.from('classes').delete().eq('id', id);
    } catch (e) {
      console.warn("Xóa class trên Supabase:", e);
    }
  }
};

// Gán học sinh vào lớp hàng loạt
export const assignStudentsToClass = async (studentIds: string[], classInfo: { classId?: string; className?: string; academicYear?: string; grade?: Grade } | null): Promise<number> => {
  if (!supabase || studentIds.length === 0) return 0;
  try {
    const allUsers = await getUsers();
    const targetUsers = allUsers.filter(u => studentIds.includes(u.id));
    
    const updatedUsers: User[] = targetUsers.map(u => ({
      ...u,
      classId: classInfo?.classId || undefined,
      className: classInfo?.className || undefined,
      academicYear: classInfo?.academicYear || undefined,
      grade: classInfo?.grade || u.grade
    }));

    await saveUsersBatch(updatedUsers);
    return updatedUsers.length;
  } catch (e) {
    console.error("Lỗi gán học sinh vào lớp:", e);
    throw e;
  }
};

// --- Question Bank ---
export const getBankQuestions = async (
    gradeFilterOrForce?: Grade | 'all' | boolean, 
    forceRefreshParam: boolean = false
): Promise<Question[]> => {
    if (!supabase) return [];
    
    let gradeFilter: Grade | 'all' | undefined;
    let forceRefresh = forceRefreshParam;

    if (typeof gradeFilterOrForce === 'boolean') {
        forceRefresh = gradeFilterOrForce;
        gradeFilter = 'all';
    } else {
        gradeFilter = gradeFilterOrForce;
    }

    const filterKey = gradeFilter || 'all';
    const cacheKey = `bank_questions_${filterKey}`;
    const now = Date.now();
    if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
      return memoryCache[cacheKey].data;
    }
    try {
        let allQuestions: any[] = [];
        let from = 0;
        const step = 1000;
        let hasMore = true;

        while (hasMore) {
            let query = supabase.from('bank_questions')
                .select('data');
            
            if (gradeFilter && gradeFilter !== 'all') {
                query = query.or(`data->>quizGrade.eq.${gradeFilter},data->>grade.eq.${gradeFilter}`);
            }

            const { data, error } = await query.range(from, from + step - 1);
            
            if (error) throw error;
            if (data && data.length > 0) {
                allQuestions = [...allQuestions, ...data];
                from += step;
                if (data.length < step) hasMore = false;
            } else {
                hasMore = false;
            }
        }
        const result = allQuestions.map((row: any) => row.data as Question);
        memoryCache[cacheKey] = { data: result, expires: now + CACHE_TTL };
        return result;
    } catch (e) {
        console.error("Lỗi lấy ngân hàng câu hỏi:", e);
        return [];
    }
};

// Hàm tạo mã băm/fingerprint nội dung câu hỏi để nhận diện trùng lặp
export const getQuestionFingerprint = (q: Question): string => {
    const normalize = (str: string) => (str || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const type = (q.type || 'mcq').toLowerCase().replace('_', '-');
    const text = normalize(q.text);
    
    // Đối với MCQ: so sánh thêm các options
    let optionsKey = '';
    if (type === 'mcq' && q.options) {
        optionsKey = q.options.map(opt => normalize(opt)).sort().join('|');
    }
    
    // Đối với Group-TF: so sánh các subQuestions
    let subKey = '';
    if (type === 'group-tf' && q.subQuestions) {
        subKey = q.subQuestions.map(sq => `${normalize(sq.text)}:${sq.correctAnswer || ''}`).join('|');
    }

    return `${type}:::${text}:::${optionsKey}:::${subKey}`;
};

export const syncQuizzesToBank = async (forceAll: boolean = false): Promise<{ 
    total: number, 
    added: number, 
    skipped: number, 
    updated: number, 
    syncedQuizzesCount: number,
    totalQuizzes: number 
}> => {
    if (!supabase) return { total: 0, added: 0, skipped: 0, updated: 0, syncedQuizzesCount: 0, totalQuizzes: 0 };
    try {
        // 1. Lấy tất cả đề thi từ database
        const { data: quizRows, error: quizError } = await supabase.from('quizzes').select('id, grade, data');
        if (quizError || !quizRows) return { total: 0, added: 0, skipped: 0, updated: 0, syncedQuizzesCount: 0, totalQuizzes: 0 };

        const totalQuizzes = quizRows.length;
        
        // Lọc ra các đề chưa được gắn cờ đồng bộ (nếu forceAll = true thì quét toàn bộ)
        const pendingQuizRows = forceAll 
            ? quizRows 
            : quizRows.filter((r: any) => {
                const qz = r.data as Quiz;
                return !qz.isSyncedToBank;
            });

        if (pendingQuizRows.length === 0) {
            return { total: 0, added: 0, skipped: 0, updated: 0, syncedQuizzesCount: 0, totalQuizzes };
        }

        // 2. Lấy tất cả câu hỏi hiện có trong kho ngân hàng để đối chiếu
        const existingBankQuestions = await getBankQuestions();
        const existingIdSet = new Set<string>();
        const existingFingerprintMap = new Map<string, Question>();
        
        existingBankQuestions.forEach(bq => {
            existingIdSet.add(bq.id);
            if (bq.bankOriginId) existingIdSet.add(bq.bankOriginId);
            const fp = getQuestionFingerprint(bq);
            existingFingerprintMap.set(fp, bq);
        });

        const questionsToSave: Question[] = [];
        let totalScanned = 0;
        let skippedCount = 0;
        let updatedCount = 0;
        let addedCount = 0;

        const currentBatchFingerprints = new Set<string>();

        for (const row of pendingQuizRows) {
            const quiz = row.data as Quiz;
            if (quiz.questions && Array.isArray(quiz.questions)) {
                quiz.questions.forEach(q => {
                    totalScanned++;

                    // Ưu tiên 1: Kiểm tra vết ID gốc (bankOriginId) - Siêu nhanh O(1)
                    if (q.bankOriginId && existingIdSet.has(q.bankOriginId)) {
                        skippedCount++;
                        return;
                    }

                    const fp = getQuestionFingerprint(q);
                    
                    // Nếu câu hỏi đã xuất hiện trong lượt quét của đợt này -> bỏ qua trùng lặp trong đề
                    if (currentBatchFingerprints.has(fp)) {
                        skippedCount++;
                        return;
                    }
                    currentBatchFingerprints.add(fp);

                    // Ưu tiên 2: Kiểm tra theo nội dung đối với các câu hỏi mới nạp từ PDF/JSON
                    const existingQ = existingFingerprintMap.get(fp);
                    if (existingQ) {
                        // Nếu câu hỏi đã có, kiểm tra xem bản mới có thông tin phong phú hơn không (VD: có thêm level hoặc solution)
                        const hasNewLevel = (!existingQ.level && q.level);
                        const hasNewSolution = (!existingQ.solution && q.solution);
                        const hasNewChapter = (!existingQ.chapterName && q.chapterName);
                        
                        if (hasNewLevel || hasNewSolution || hasNewChapter) {
                            const enriched: Question = {
                                ...existingQ,
                                level: q.level || existingQ.level,
                                solution: q.solution || existingQ.solution,
                                chapterName: q.chapterName || existingQ.chapterName || quiz.category,
                                chapterId: q.chapterId || existingQ.chapterId,
                                quizTitle: quiz.title || existingQ.quizTitle,
                                quizGrade: quiz.grade || existingQ.quizGrade,
                                quizCategory: q.chapterName || quiz.category || existingQ.quizCategory
                            };
                            questionsToSave.push(enriched);
                            updatedCount++;
                        } else {
                            skippedCount++;
                        }
                    } else {
                        // Câu hỏi hoàn toàn mới chưa có trong Ngân hàng -> Thêm mới
                        const newQ: Question = {
                            ...q,
                            chapterName: q.chapterName || quiz.category,
                            chapterId: q.chapterId,
                            quizTitle: quiz.title,
                            quizGrade: quiz.grade,
                            quizCategory: q.chapterName || quiz.category
                        };
                        questionsToSave.push(newQ);
                        existingFingerprintMap.set(fp, newQ);
                        if (newQ.id) existingIdSet.add(newQ.id);
                        addedCount++;
                    }
                });
            }
        }

        // 3. Lưu câu hỏi mới/cập nhật vào bank_questions
        if (questionsToSave.length > 0) {
            const chunkSize = 50;
            for (let i = 0; i < questionsToSave.length; i += chunkSize) {
                const chunk = questionsToSave.slice(i, i + chunkSize);
                const payload = chunk.map(q => ({ id: q.id, data: q }));
                await supabase.from('bank_questions').upsert(payload);
            }
        }

        // 4. Gắn cờ isSyncedToBank: true cho các đề thi vừa được quét xong (thực thi song song nhanh chóng)
        const nowIso = new Date().toISOString();
        const updatePromises = pendingQuizRows.map((row: any) => {
            const quiz = row.data as Quiz;
            const updatedQuiz: Quiz = {
                ...quiz,
                isSyncedToBank: true,
                syncedToBankAt: nowIso
            };
            return supabase!.from('quizzes').update({
                data: updatedQuiz,
                grade: row.grade || quiz.grade
            }).eq('id', row.id);
        });
        await Promise.all(updatePromises);

        return { 
            total: totalScanned, 
            added: addedCount, 
            skipped: skippedCount, 
            updated: updatedCount, 
            syncedQuizzesCount: pendingQuizRows.length,
            totalQuizzes 
        };
    } catch (e) {
        console.error("Lỗi đồng bộ về Ngân hàng:", e);
        return { total: 0, added: 0, skipped: 0, updated: 0, syncedQuizzesCount: 0, totalQuizzes: 0 };
    }
};

export const saveBankQuestion = async (q: Question): Promise<void> => {
    if (!supabase) return;
    try {
        const fp = getQuestionFingerprint(q);
        const existing = await getBankQuestions();
        const found = existing.find(item => getQuestionFingerprint(item) === fp);
        const finalId = found ? found.id : q.id;
        await supabase.from('bank_questions').upsert({ id: finalId, data: { ...q, id: finalId } });
    } catch (e) {
        console.warn("Lỗi lưu bank question:", e);
    }
};

// --- Cấu hình lưu trữ hình ảnh (ImgBB & Supabase Storage) ---
export type ImageStorageProvider = 'auto' | 'imgbb' | 'supabase';

export interface ImageStorageConfig {
    provider: ImageStorageProvider;
    imgbbApiKey: string;
}

export const DEFAULT_IMGBB_KEY = '2ea8b9b28f97a0369bac68c8cd6c0a3d';

export const getImageStorageConfig = (): ImageStorageConfig => {
    try {
        const storedProvider = localStorage.getItem('eduquiz_image_provider') as ImageStorageProvider;
        const storedKey = localStorage.getItem('eduquiz_imgbb_key');
        return {
            provider: (storedProvider === 'imgbb' || storedProvider === 'supabase' || storedProvider === 'auto') ? storedProvider : 'auto',
            imgbbApiKey: (storedKey && storedKey.trim()) ? storedKey.trim() : DEFAULT_IMGBB_KEY
        };
    } catch (e) {
        return {
            provider: 'auto',
            imgbbApiKey: DEFAULT_IMGBB_KEY
        };
    }
};

export const saveImageStorageConfig = (config: Partial<ImageStorageConfig>): void => {
    try {
        if (config.provider) {
            localStorage.setItem('eduquiz_image_provider', config.provider);
        }
        if (config.imgbbApiKey !== undefined) {
            localStorage.setItem('eduquiz_imgbb_key', config.imgbbApiKey.trim());
        }
    } catch (e) {}
};

/**
 * Tải ảnh trực tiếp lên ImgBB qua API
 */
export const uploadToImgbb = async (file: File | Blob, apiKey?: string): Promise<string> => {
    const key = (apiKey && apiKey.trim()) || getImageStorageConfig().imgbbApiKey || DEFAULT_IMGBB_KEY;
    if (!key) throw new Error("Chưa cung cấp ImgBB API Key");

    const formData = new FormData();
    formData.append('image', file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

    try {
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.error?.message || `ImgBB trả về mã lỗi HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || !data.success || !data.data) {
            throw new Error(data?.error?.message || "ImgBB không trả về dữ liệu hình ảnh hợp lệ");
        }

        // Trả về direct URL của ảnh (display_url hoặc url trên CDN i.ibb.co)
        const imageUrl = data.data.display_url || data.data.url;
        if (!imageUrl) {
            throw new Error("Không tìm thấy đường link ảnh từ ImgBB");
        }
        return imageUrl;
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error("Tải ảnh lên ImgBB bị quá thời gian chờ (Timeout)");
        }
        throw error;
    }
};

/**
 * Tải ảnh lên Supabase Storage (Bucket 'quiz-images')
 */
export const uploadToSupabaseStorage = async (file: File | Blob): Promise<string> => {
    if (!supabase) throw new Error("Mất kết nối Supabase");
    const fileExt = (file instanceof File && file.name ? file.name.split('.').pop() : 'png') || 'png';
    const fileName = `${uuidv4()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('quiz-images').upload(fileName, file, {
        contentType: (file as any).type || 'image/png',
        upsert: true
    });

    if (uploadError) {
        throw uploadError;
    }

    const { data } = supabase.storage.from('quiz-images').getPublicUrl(fileName);
    if (!data?.publicUrl) {
        throw new Error("Không lấy được Public URL từ Supabase Storage");
    }
    return data.publicUrl;
};

export interface ImageUploadResult {
    url: string;
    provider: 'imgbb' | 'supabase' | 'base64';
    error?: string;
}

/**
 * Tải ảnh đề thi với cơ chế lựa chọn thông minh & tự động fallback:
 * Ưu tiên ImgBB -> Chuyển Supabase Storage -> Chuyển Base64 DataURL
 */
export const uploadQuizImageWithResult = async (
    file: File | Blob, 
    customProvider?: ImageStorageProvider,
    customApiKey?: string
): Promise<ImageUploadResult> => {
    const config = getImageStorageConfig();
    const provider = customProvider || config.provider;
    const apiKey = customApiKey || config.imgbbApiKey;

    const toBase64 = (f: File | Blob): Promise<string> => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string || '');
            reader.onerror = () => resolve('');
            reader.readAsDataURL(f);
        });
    };

    // 1. Chế độ 'auto' (Ưu tiên ImgBB -> Fallback Supabase Storage -> Fallback Base64)
    if (provider === 'auto') {
        try {
            const imgbbUrl = await uploadToImgbb(file, apiKey);
            return { url: imgbbUrl, provider: 'imgbb' };
        } catch (imgbbErr: any) {
            console.warn("⚠️ Upload ImgBB không thành công, tự động chuyển sang Supabase Storage:", imgbbErr?.message || imgbbErr);
            try {
                const supabaseUrl = await uploadToSupabaseStorage(file);
                return { url: supabaseUrl, provider: 'supabase' };
            } catch (supabaseErr: any) {
                console.warn("⚠️ Upload Supabase Storage cũng không thành công, fallback sang Base64 DataURL:", supabaseErr?.message || supabaseErr);
                const base64Url = await toBase64(file);
                return { 
                    url: base64Url, 
                    provider: 'base64', 
                    error: `ImgBB: ${imgbbErr?.message || 'Lỗi'}; Supabase: ${supabaseErr?.message || 'Lỗi'}` 
                };
            }
        }
    }

    // 2. Chế độ 'imgbb' (Chỉ dùng ImgBB -> Fallback Base64)
    if (provider === 'imgbb') {
        try {
            const imgbbUrl = await uploadToImgbb(file, apiKey);
            return { url: imgbbUrl, provider: 'imgbb' };
        } catch (imgbbErr: any) {
            console.warn("⚠️ Upload ImgBB thất bại, fallback sang Base64:", imgbbErr);
            const base64Url = await toBase64(file);
            return { url: base64Url, provider: 'base64', error: imgbbErr?.message };
        }
    }

    // 3. Chế độ 'supabase' (Chỉ dùng Supabase Storage -> Fallback Base64)
    if (provider === 'supabase') {
        try {
            const supabaseUrl = await uploadToSupabaseStorage(file);
            return { url: supabaseUrl, provider: 'supabase' };
        } catch (supabaseErr: any) {
            console.warn("⚠️ Upload Supabase thất bại, fallback sang Base64:", supabaseErr);
            const base64Url = await toBase64(file);
            return { url: base64Url, provider: 'base64', error: supabaseErr?.message };
        }
    }

    const fallbackUrl = await toBase64(file);
    return { url: fallbackUrl, provider: 'base64' };
};

export const uploadQuizImage = async (file: File | Blob): Promise<string> => {
    const res = await uploadQuizImageWithResult(file);
    return res.url;
};

export const getPublishedResults = async (limit: number = 20, forceRefresh: boolean = false): Promise<PublishedResult[]> => {
    if (!supabase) return [];
    const cacheKey = `published_results_${limit}`;
    const now = Date.now();
    if (!forceRefresh && memoryCache[cacheKey] && memoryCache[cacheKey].expires > now) {
      return memoryCache[cacheKey].data;
    }
    const { data } = await supabase.from('published_results').select('data').order('id', { ascending: false }).limit(limit);
    const result = data ? data.map((row: any) => row.data as PublishedResult) : [];
    memoryCache[cacheKey] = { data: result, expires: now + CACHE_TTL };
    return result;
};

export const savePublishedResult = async (pub: PublishedResult): Promise<void> => {
    invalidateCache('published_results');
    if (supabase) await supabase.from('published_results').upsert({ id: pub.id, data: pub });
};

export const deletePublishedResult = async (id: string): Promise<void> => {
    invalidateCache('published_results');
    if (supabase) await supabase.from('published_results').delete().eq('id', id);
};

export const saveExamSession = async (session: ExamSession): Promise<void> => {
    if (supabase) await supabase.from('exam_sessions').upsert({ id: session.id, data: session });
};

export const deleteExamSession = async (id: string): Promise<void> => {
    if (supabase) await supabase.from('exam_sessions').delete().eq('id', id);
};

export const getExamSessions = async (quizId?: string): Promise<ExamSession[]> => {
    if (!supabase) return [];
    let query = supabase.from('exam_sessions').select('data');
    if (quizId && quizId !== 'all') query = query.filter('data->>quizId', 'eq', quizId);
    const { data } = await query;
    return data ? data.map((row: any) => row.data as ExamSession) : [];
};

export const getStudentActiveSessions = async (studentId: string): Promise<ExamSession[]> => {
    if (!supabase) return [];
    const { data } = await supabase.from('exam_sessions').select('data').filter('data->>studentId', 'eq', studentId);
    return data ? data.map((row: any) => row.data as ExamSession) : [];
};

export const clearAllSessions = async () => {
    if (supabase) await supabase.from('exam_sessions').delete().neq('id', 'null');
};

export const initStorage = () => {};
export const clearLocalCache = () => { localStorage.clear(); window.location.reload(); };
