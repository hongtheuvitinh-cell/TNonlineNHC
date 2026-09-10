/// <reference types="vite/client" />

import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  writeBatch,
  getCountFromServer,
  startAfter,
  DocumentSnapshot
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getStorage, deleteObject } from 'firebase/storage';
import app, { db, storage } from './firebase';
import { User, Quiz, Result, Chapter, Question, ExamSession, PublishedResult, Grade, ClassRoom } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { isSameSubject } from './subjectUtils';
import { getCurrentAcademicYear, getQuizAcademicYear } from './academicUtils';
import { uploadImageToSupabaseStorage } from './supabaseMigration';
import { supabaseDb, isSupabaseConnected } from './supabaseService';

import firebaseConfig from '../firebase-applet-config.json';

export type DatabaseProvider = 'supabase' | 'firebase' | 'dual';

export const getActiveDatabaseProvider = (): DatabaseProvider => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('eduquiz_db_provider');
    if (saved === 'supabase') return 'supabase';
    if (saved === 'firebase') return 'firebase';
    if (saved === 'dual') return 'dual';
  }
  // Mặc định thuần túy Supabase để đạt tốc độ tối đa và không phụ thuộc Firestore, nếu chưa có thì dùng Firebase
  return isSupabaseConnected() ? 'supabase' : 'firebase';
};

export const setActiveDatabaseProvider = (provider: DatabaseProvider): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('eduquiz_db_provider', provider);
    window.dispatchEvent(new CustomEvent('eduquiz-provider-changed', { detail: provider }));
  }
};

export const isSupabasePrimary = (): boolean => {
  const p = getActiveDatabaseProvider();
  return p === 'supabase' || p === 'dual';
};

export const isDualSyncActive = (): boolean => {
  return getActiveDatabaseProvider() === 'dual' && !!db && isSupabaseConnected();
};

export const isDatabaseConnected = (): boolean => {
  return isSupabaseConnected() || !!db;
};

// Deeply clean all undefined values to ensure Firestore writes never fail
export function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => cleanUndefined(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanUndefined(value);
      }
    }
    return cleaned;
  }
  return obj;
}

import { formatToDatetimeLocal, normalizeDateTimeForStorage } from './dateUtils';
export { formatToDatetimeLocal, normalizeDateTimeForStorage };

// --- Database Usage Stats Helpers ---
export interface DailyFirestoreStats {
  date: string;
  totalReads: number;
  totalWrites: number;
  totalDeletes: number;
  readsByCollection: Record<string, number>;
  lastUpdated: string;
}

export const getDailyFirestoreStats = (): DailyFirestoreStats => {
  return {
    date: new Date().toLocaleDateString('en-CA'),
    totalReads: 0,
    totalWrites: 0,
    totalDeletes: 0,
    readsByCollection: {},
    lastUpdated: new Date().toISOString()
  };
};

export const trackFirestoreRead = (_collectionName: string, _count: number = 1) => {};
export const trackFirestoreWrite = (_collectionName: string, _count: number = 1) => {};
export const trackFirestoreDelete = (_collectionName: string, _count: number = 1) => {};
export const resetDailyFirestoreStats = (): DailyFirestoreStats => getDailyFirestoreStats();

// Test Database Connection
export const testFirebaseConnection = async (): Promise<{ success: boolean; message: string }> => {
  if (isSupabasePrimary() || isSupabaseConnected()) {
    const sbResult = await supabaseDb.ping();
    if (sbResult.success) {
      return { success: true, message: `Kết nối CSDL Supabase (PostgreSQL) thành công! (${sbResult.latencyMs}ms)` };
    }
  }
  if (!db) return { success: false, message: "Firebase client chưa khởi tạo" };
  try {
    const q = query(collection(db, 'users'), limit(1));
    const snapshot = await getDocs(q);
    trackFirestoreRead('users', snapshot.docs.length || 1);
    return { success: true, message: `Kết nối Firebase Cloud Firestore thành công. (${snapshot.size} bản ghi mẫu)` };
  } catch (e: any) {
    console.error("Lỗi Exception kết nối Firebase:", e);
    const errStr = (e?.message || JSON.stringify(e) || '').toLowerCase();
    if (errStr.includes('quota') || errStr.includes('resource_exhausted') || errStr.includes('limit exceeded')) {
      return { 
        success: false, 
        message: "Hạn mức đọc CSDL miễn phí trong ngày (50.000 reads) của Firebase hôm nay đã đạt tối đa. Hệ thống đã tự động chuyển hướng hoặc bạn có thể dùng Supabase." 
      };
    }
    return { success: false, message: `Lỗi kết nối Firestore: ${e.message || JSON.stringify(e)}` };
  }
};

// Test Supabase Connection
export const testSupabaseConnection = async (): Promise<{ success: boolean; message: string; latencyMs?: number }> => {
  return await supabaseDb.ping();
};

// --- Results ---
export const getResultsMetadataPage = async (
  page: number, 
  pageSize: number = 50, 
  quizId?: string, 
  search?: string
): Promise<{ data: Result[]; total: number }> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getResultsMetadataPage(page, pageSize, quizId, search);
  }
  if (!db) return { data: [], total: 0 };
  try {
    let qRef = collection(db, 'results');
    let constraints: any[] = [];

    if (quizId && quizId !== 'all') {
      constraints.push(where('quizId', '==', quizId));
    }

    const totalSnapshot = await getDocs(query(qRef, ...constraints));
    trackFirestoreRead('results', totalSnapshot.docs.length);
    let allResults = totalSnapshot.docs.map(d => {
      const row = d.data();
      return (row.data as Result) || ({ ...row, id: d.id } as Result);
    });

    if (search) {
      const s = search.trim().toLowerCase();
      allResults = allResults.filter(r => 
        (r.studentName && r.studentName.toLowerCase().includes(s)) ||
        (r.studentCode && r.studentCode.toLowerCase().includes(s))
      );
    }

    // Sort by submittedAt descending or id
    allResults.sort((a, b) => {
      const tA = new Date(a.submittedAt || 0).getTime();
      const tB = new Date(b.submittedAt || 0).getTime();
      return tB - tA;
    });

    const total = allResults.length;
    const from = (page - 1) * pageSize;
    const paged = allResults.slice(from, from + pageSize);

    return { data: paged, total };
  } catch (e) {
    console.error("Lỗi getResultsMetadataPage Firestore:", e);
    return { data: [], total: 0 };
  }
};

export const getResultsMetadata = async (quizId?: string, maxRecords: number = 10000): Promise<Result[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getResults(quizId, maxRecords);
  }
  if (!db) return [];
  try {
    let qRef = collection(db, 'results');
    let q = query(qRef, limit(maxRecords));
    if (quizId && quizId !== 'all') {
      q = query(qRef, where('quizId', '==', quizId), limit(maxRecords));
    }

    const snapshot = await getDocs(q);
    trackFirestoreRead('results', snapshot.docs.length);
    return snapshot.docs.map(d => {
      const row = d.data();
      const res = (row.data as Result) || (row as Result);
      return {
        ...res,
        id: d.id,
        quizId: row.quizId || res.quizId,
        studentId: row.studentId || res.studentId
      };
    });
  } catch (e) {
    console.error("Lỗi getResultsMetadata Firestore:", e);
    return [];
  }
};

export const getResultsCount = async (quizId?: string): Promise<number> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getResultsCount(quizId);
  }
  if (!db) return 0;
  try {
    let qRef = collection(db, 'results');
    let q = query(qRef);
    if (quizId && quizId !== 'all') {
      q = query(qRef, where('quizId', '==', quizId));
    }
    const snapshot = await getCountFromServer(q);
    trackFirestoreRead('results', 1);
    return snapshot.data().count;
  } catch (e) {
    return 0;
  }
};

export const getResults = async (quizId?: string, maxRecords: number = 5000): Promise<Result[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getResults(quizId, maxRecords);
  }
  if (!db) return [];
  try {
    let qRef = collection(db, 'results');
    let q = query(qRef, limit(maxRecords));
    if (quizId && quizId !== 'all') {
      q = query(qRef, where('quizId', '==', quizId), limit(maxRecords));
    }
    const snapshot = await getDocs(q);
    trackFirestoreRead('results', snapshot.docs.length);
    return snapshot.docs.map(d => {
      const row = d.data();
      return (row.data as Result) || (row as Result);
    });
  } catch (e) {
    return [];
  }
};

export const getResultsForStudent = async (studentId: string, studentCode?: string): Promise<Result[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getResultsForStudent(studentId, studentCode);
  }
  if (!db) return [];
  try {
    const qRef = collection(db, 'results');
    const q = query(qRef, where('studentId', '==', studentId), limit(500));
    const snapshot = await getDocs(q);
    trackFirestoreRead('results', snapshot.docs.length);
    let results = snapshot.docs.map(d => {
      const row = d.data();
      return (row.data as Result) || (row as Result);
    });

    if (studentCode && studentCode !== 'N/A') {
      const code = studentCode.trim().toUpperCase();
      const qCode = query(qRef, where('studentCode', '==', code), limit(500));
      const codeSnapshot = await getDocs(qCode);
      trackFirestoreRead('results', codeSnapshot.docs.length);
      const codeResults = codeSnapshot.docs.map(d => {
        const row = d.data();
        return (row.data as Result) || (row as Result);
      });
      
      // Merge unique by id
      const map = new Map<string, Result>();
      [...results, ...codeResults].forEach(r => map.set(r.id, r));
      results = Array.from(map.values());
    }

    results.sort((a, b) => {
      const tA = new Date(a.submittedAt || 0).getTime();
      const tB = new Date(b.submittedAt || 0).getTime();
      return tB - tA;
    });

    return results;
  } catch (e) {
    console.error("Lỗi getResultsForStudent:", e);
    return [];
  }
};

export const verifyResultExists = async (id: string): Promise<boolean> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.getResultById(id);
    return !!res;
  }
  if (!db) return false;
  try {
    const docSnap = await getDoc(doc(db, 'results', id));
    trackFirestoreRead('results', 1);
    return docSnap.exists();
  } catch (e) {
    return false;
  }
};

export const getResultById = async (id: string, forceRefresh: boolean = false): Promise<Result | null> => {
  if (!id) return null;
  const now = Date.now();
  if (!forceRefresh && memoryCache.resultDetails?.has(id)) {
    const cached = memoryCache.resultDetails.get(id);
    if (cached && cached.expires > now && cached.data) {
      return cached.data;
    }
  }

  // Kiểm tra sessionStorage / localStorage
  if (!forceRefresh) {
    try {
      const localKey = `eduquiz_result_detail_${id}`;
      const localStr = sessionStorage.getItem(localKey) || localStorage.getItem(localKey);
      if (localStr) {
        const parsed = JSON.parse(localStr);
        if (parsed && parsed.data && parsed.expires > now) {
          if (!memoryCache.resultDetails) memoryCache.resultDetails = new Map();
          memoryCache.resultDetails.set(id, { data: parsed.data, expires: parsed.expires });
          return parsed.data;
        }
      }
    } catch {}
  }

  let result: Result | null = null;
  if (isSupabasePrimary()) {
    result = await supabaseDb.getResultById(id);
  } else if (db) {
    try {
      const docSnap = await getDoc(doc(db, 'results', id));
      trackFirestoreRead('results', 1);
      if (docSnap.exists()) {
        const data = docSnap.data();
        result = (data.data as Result) || (data as Result);
      }
    } catch (e) {
      console.error("Lỗi getResultById:", e);
      return null;
    }
  }

  if (result) {
    if (!memoryCache.resultDetails) memoryCache.resultDetails = new Map();
    const expires = now + 60 * 60 * 1000; // Cache 60 phút
    memoryCache.resultDetails.set(id, { data: result, expires });
    try {
      sessionStorage.setItem(`eduquiz_result_detail_${id}`, JSON.stringify({ data: result, expires }));
    } catch {}
  }

  return result;
};

export const saveResultToFirestore = async (result: Result): Promise<void> => {
  if (result && result.id) {
    if (!memoryCache.resultDetails) memoryCache.resultDetails = new Map();
    const expires = Date.now() + 60 * 60 * 1000;
    memoryCache.resultDetails.set(result.id, { data: result, expires });
    try {
      sessionStorage.setItem(`eduquiz_result_detail_${result.id}`, JSON.stringify({ data: result, expires }));
    } catch {}
  }
  if (!db) return;
  const payload = {
    id: result.id,
    quizId: result.quizId,
    studentId: result.studentId,
    studentName: result.studentName || '',
    studentCode: (result.studentCode || '').trim().toUpperCase(),
    score: result.score,
    submittedAt: result.submittedAt || new Date().toISOString(),
    data: cleanUndefined(result)
  };
  await setDoc(doc(db, 'results', result.id), cleanUndefined(payload));
  trackFirestoreWrite('results', 1);
};

export const saveResult = async (result: Result): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveResult(result);
    if (isDualSyncActive()) {
      saveResultToFirestore(result).catch((err) => {
        console.warn("Dual sync result to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveResultToFirestore(result);
};

export const deleteResultFromFirestore = async (id: string): Promise<void> => {
  if (db) {
    await deleteDoc(doc(db, 'results', id));
    trackFirestoreDelete('results', 1);
  }
};

export const deleteResult = async (id: string): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteResult(id);
    if (isDualSyncActive()) {
      deleteResultFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deleteResultFromFirestore(id);
};

export const updateResultCode = async (id: string, code: string): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.updateResultCode(id, code);
    if (isDualSyncActive() && db) {
      try {
        const docRef = doc(db, 'results', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const currentData = docSnap.data();
          const resData = { ...((currentData.data as Result) || currentData), studentCode: code.trim().toUpperCase() };
          await updateDoc(docRef, {
            studentCode: code.trim().toUpperCase(),
            data: cleanUndefined(resData)
          });
        }
      } catch {}
    }
    return res;
  }
  if (!db) return;
  const docRef = doc(db, 'results', id);
  const docSnap = await getDoc(docRef);
  trackFirestoreRead('results', 1);
  if (!docSnap.exists()) return;
  const currentData = docSnap.data();
  const resData = { ...((currentData.data as Result) || currentData), studentCode: code.trim().toUpperCase() };
  await updateDoc(docRef, {
    studentCode: code.trim().toUpperCase(),
    data: cleanUndefined(resData)
  });
  trackFirestoreWrite('results', 1);
};

// --- Users ---
export const getUsersPage = async (
  page: number, 
  pageSize: number = 50, 
  search?: string
): Promise<{ data: User[]; total: number }> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getUsersPage(page, pageSize, search);
  }
  if (!db) return { data: [], total: 0 };
  try {
    const qRef = collection(db, 'users');
    const snapshot = await getDocs(qRef);
    trackFirestoreRead('users', snapshot.docs.length);
    let allUsers = snapshot.docs.map(d => {
      const row = d.data();
      const parsed = (row.data as User) || ({ ...row, id: d.id } as User);
      return {
        ...parsed,
        id: d.id,
        classId: parsed.classId || row.classId || '',
        className: parsed.className || row.className || '',
        academicYear: parsed.academicYear || row.academicYear || '',
        createdById: parsed.createdById || row.createdById || '',
      };
    });

    if (search) {
      const s = search.trim().toLowerCase();
      allUsers = allUsers.filter(u => 
        (u.fullName && u.fullName.toLowerCase().includes(s)) ||
        (u.studentCode && u.studentCode.toLowerCase().includes(s)) ||
        (u.username && u.username.toLowerCase().includes(s))
      );
    }

    allUsers.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

    const total = allUsers.length;
    const from = (page - 1) * pageSize;
    const paged = allUsers.slice(from, from + pageSize);

    return { data: paged, total };
  } catch (e) {
    console.error("Lỗi getUsersPage Firestore:", e);
    return { data: [], total: 0 };
  }
};

export const getUsers = async (forceRefresh: boolean = false): Promise<User[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getUsers();
  }
  const now = Date.now();
  if (!forceRefresh && memoryCache.users && memoryCache.users.expires > now) {
    return memoryCache.users.data;
  }
  if (!db) {
    try {
      const local = localStorage.getItem('eduquiz_users_cache');
      if (local) return JSON.parse(local);
    } catch {}
    return [];
  }
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    trackFirestoreRead('users', snapshot.docs.length);
    const users = snapshot.docs.map(d => {
      const row = d.data();
      const parsed = (row.data as User) || ({ ...row, id: d.id } as User);
      return {
        ...parsed,
        id: d.id,
        classId: parsed.classId || row.classId || '',
        className: parsed.className || row.className || '',
        academicYear: parsed.academicYear || row.academicYear || '',
        createdById: parsed.createdById || row.createdById || '',
      };
    });
    memoryCache.users = { data: users, expires: now + 5 * 60 * 1000 };
    try {
      localStorage.setItem('eduquiz_users_cache', JSON.stringify(users));
    } catch {}
    return users;
  } catch (e) {
    console.error("Lỗi getUsers Firestore:", e);
    try {
      const local = localStorage.getItem('eduquiz_users_cache');
      if (local) return JSON.parse(local);
    } catch {}
    return [];
  }
};

export const saveUserToFirestore = async (user: User): Promise<void> => {
  invalidateMemoryCache('users');
  if (!db) return;
  const payload = {
    id: user.id,
    username: (user.username || '').toLowerCase().trim(),
    role: user.role || 'student',
    fullName: user.fullName || '',
    studentCode: (user.studentCode || '').trim().toUpperCase(),
    grade: user.grade || '12',
    points: user.points || 0,
    classId: user.classId || '',
    className: user.className || '',
    academicYear: user.academicYear || '',
    email: user.email || '',
    phone: user.phone || '',
    subject: user.subject || '',
    createdById: user.createdById || '',
    createdAt: user.createdAt || new Date().toISOString(),
    password: user.password || '123',
    data: cleanUndefined(user)
  };
  await setDoc(doc(db, 'users', user.id), cleanUndefined(payload), { merge: true });
  trackFirestoreWrite('users', 1);
};

export const saveUser = async (user: User): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveUser(user);
    if (isDualSyncActive()) {
      saveUserToFirestore(user).catch((err) => {
        console.warn("Dual sync user to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveUserToFirestore(user);
};

export const saveUsersBatchToFirestore = async (users: User[]): Promise<void> => {
  invalidateMemoryCache('users');
  if (!db || users.length === 0) return;
  const chunkSize = 400;
  for (let i = 0; i < users.length; i += chunkSize) {
    const chunk = users.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const user of chunk) {
      const userRef = doc(db, 'users', user.id);
      const payload = {
        id: user.id,
        username: (user.username || '').toLowerCase().trim(),
        role: user.role || 'student',
        fullName: user.fullName || '',
        studentCode: (user.studentCode || '').trim().toUpperCase(),
        grade: user.grade || '12',
        points: user.points || 0,
        classId: user.classId || '',
        className: user.className || '',
        academicYear: user.academicYear || '',
        email: user.email || '',
        phone: user.phone || '',
        subject: user.subject || '',
        createdById: user.createdById || '',
        createdAt: user.createdAt || new Date().toISOString(),
        password: user.password || '123',
        data: cleanUndefined(user)
      };
      batch.set(userRef, cleanUndefined(payload), { merge: true });
    }
    await batch.commit();
    trackFirestoreWrite('users', chunk.length);
  }
};

export const saveUsersBatch = async (users: User[]): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveUsersBatch(users);
    if (isDualSyncActive()) {
      saveUsersBatchToFirestore(users).catch((err) => {
        console.warn("Dual sync users batch to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveUsersBatchToFirestore(users);
};

// Memory cache to drastically reduce Firebase/Supabase read quota and bandwidth consumption
const memoryCache: {
  users?: { data: User[]; expires: number };
  teachers?: { data: User[]; expires: number };
  chapters?: { data: Chapter[]; expires: number };
  classes?: { data: ClassRoom[]; expires: number };
  quizzesMeta?: { data: Quiz[]; expires: number };
  bankQuestions?: { data: Question[]; expires: number };
  bankByFilter?: Map<string, { data: Question[]; expires: number }>;
  quizDetails?: Map<string, { data: Quiz; expires: number }>;
  resultDetails?: Map<string, { data: Result; expires: number }>;
} = {};

export const cacheResultDetails = (results: Result[]): void => {
  if (!Array.isArray(results) || results.length === 0) return;
  if (!memoryCache.resultDetails) memoryCache.resultDetails = new Map();
  const expires = Date.now() + 60 * 60 * 1000; // 60 phút
  for (const r of results) {
    if (r && r.id) {
      memoryCache.resultDetails.set(r.id, { data: r, expires });
      try {
        sessionStorage.setItem(`eduquiz_result_detail_${r.id}`, JSON.stringify({ data: r, expires }));
      } catch {}
    }
  }
};

export const invalidateMemoryCache = (key?: 'users' | 'teachers' | 'chapters' | 'classes' | 'quizzes' | 'bank' | 'results') => {
  if (!key) {
    delete memoryCache.users;
    delete memoryCache.teachers;
    delete memoryCache.chapters;
    delete memoryCache.classes;
    delete memoryCache.quizzesMeta;
    delete memoryCache.bankQuestions;
    delete memoryCache.quizDetails;
    delete memoryCache.resultDetails;
    try {
      localStorage.removeItem('eduquiz_users_cache');
      localStorage.removeItem('eduquiz_quizzes_meta_cache');
    } catch {}
  } else if (key === 'users') {
    delete memoryCache.users;
    try {
      localStorage.removeItem('eduquiz_users_cache');
    } catch {}
  } else if (key === 'teachers') {
    delete memoryCache.teachers;
  } else if (key === 'chapters') {
    delete memoryCache.chapters;
  } else if (key === 'classes') {
    delete memoryCache.classes;
  } else if (key === 'quizzes') {
    delete memoryCache.quizzesMeta;
    delete memoryCache.quizDetails;
    try {
      localStorage.removeItem('eduquiz_quizzes_meta_cache');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('eduquiz_quiz_detail_')) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
  } else if (key === 'bank') {
    delete memoryCache.bankQuestions;
    delete memoryCache.bankByFilter;
  } else if (key === 'results') {
    delete memoryCache.resultDetails;
  }
};

// --- Teachers Management (SuperAdmin) ---
export const getTeachers = async (forceRefresh: boolean = false): Promise<User[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getTeachers();
  }
  if (!db) return [];
  const now = Date.now();
  if (!forceRefresh && memoryCache.teachers && memoryCache.teachers.expires > now) {
    return memoryCache.teachers.data;
  }

  try {
    const qRef = collection(db, 'users');
    // Targeted query for only teacher/admin accounts rather than scanning entire collection
    const q = query(qRef, where('role', 'in', ['admin', 'superadmin', 'teacher']));
    const snapshot = await getDocs(q);
    trackFirestoreRead('users', snapshot.docs.length);
    
    let teachers: User[] = [];
    if (!snapshot.empty) {
      teachers = snapshot.docs.map(d => {
        const row = d.data();
        return (row.data as User) || ({ ...row, id: d.id } as User);
      });
    } else {
      // Fallback in case indexed query is empty
      const allSnap = await getDocs(query(qRef, limit(50)));
      trackFirestoreRead('users', allSnap.docs.length);
      teachers = allSnap.docs
        .map(d => {
          const row = d.data();
          return (row.data as User) || ({ ...row, id: d.id } as User);
        })
        .filter(u => u.role === 'admin' || u.role === 'superadmin' || (u.role as any) === 'teacher');
    }
    
    teachers.sort((a, b) => {
      if (a.role === 'superadmin') return -1;
      if (b.role === 'superadmin') return 1;
      return (a.fullName || '').localeCompare(b.fullName || '');
    });

    memoryCache.teachers = { data: teachers, expires: now + 5 * 60 * 1000 }; // 5 min cache
    return teachers;
  } catch (e) {
    console.error("Lỗi getTeachers:", e);
    return memoryCache.teachers?.data || [];
  }
};

export const saveTeacher = async (teacher: User): Promise<void> => {
  invalidateMemoryCache('teachers');
  await saveUser(teacher);

  // Tự động đồng bộ tên giáo viên mới vào tất cả Lớp học và Đề thi do GV này phụ trách
  if (db && teacher.id && teacher.fullName) {
    try {
      // 1. Cập nhật các Lớp học do GV tạo (createdBy == teacher.id)
      const classesQuery = query(collection(db, 'classes'), where('createdBy', '==', teacher.id));
      const classesSnap = await getDocs(classesQuery);
      trackFirestoreRead('classes', classesSnap.docs.length);
      if (!classesSnap.empty) {
        const batch = writeBatch(db);
        classesSnap.forEach(classDoc => {
          batch.update(classDoc.ref, {
            teacherName: teacher.fullName,
            'data.teacherName': teacher.fullName
          });
        });
        await batch.commit();
        trackFirestoreWrite('classes', classesSnap.docs.length);
        invalidateMemoryCache('classes');
      }

      // 2. Cập nhật các Đề thi do GV tạo (createdBy == teacher.id)
      const quizMetaQuery = query(collection(db, 'quizzes_metadata'), where('createdBy', '==', teacher.id));
      const quizMetaSnap = await getDocs(quizMetaQuery);
      trackFirestoreRead('quizzes_metadata', quizMetaSnap.docs.length);
      if (!quizMetaSnap.empty) {
        const batch = writeBatch(db);
        quizMetaSnap.forEach(qDoc => {
          batch.update(qDoc.ref, {
            createdByName: teacher.fullName,
            'data.createdByName': teacher.fullName
          });
        });
        await batch.commit();
        trackFirestoreWrite('quizzes_metadata', quizMetaSnap.docs.length);
        invalidateMemoryCache('quizzes');
      }
    } catch (err) {
      console.warn("Lỗi đồng bộ tên giáo viên sang các lớp/đề thi:", err);
    }
  }

  // Cập nhật local storage cache của lớp học nếu có
  try {
    const local = localStorage.getItem('eduquiz_classes_cache');
    if (local) {
      const parsedClasses: ClassRoom[] = JSON.parse(local);
      const updated = parsedClasses.map(c => c.createdBy === teacher.id ? { ...c, teacherName: teacher.fullName } : c);
      localStorage.setItem('eduquiz_classes_cache', JSON.stringify(updated));
    }
  } catch (e) {}
};

export const deleteTeacher = async (id: string): Promise<void> => {
  invalidateMemoryCache('teachers');
  return deleteUser(id);
};

export const addPointsToUser = async (userId: string, points: number): Promise<void> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.addPointsToUser(userId, points);
  }
  if (!db) return;
  try {
    const docRef = doc(db, 'users', userId);
    const docSnap = await getDoc(docRef);
    trackFirestoreRead('users', 1);
    if (docSnap.exists()) {
      const raw = docSnap.data();
      const userData: User = raw.data || raw;
      const updatedUser: User = { ...userData, points: (userData.points || 0) + points };
      await updateDoc(docRef, {
        points: updatedUser.points,
        data: updatedUser
      });
      trackFirestoreWrite('users', 1);
    }
  } catch (e) {
    console.error("Lỗi addPointsToUser:", e);
  }
};

export const findUserByStudentCode = async (code: string): Promise<User | undefined> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.findUserByStudentCode(code);
  }
  if (!db) return undefined;
  try {
    const targetCode = code.trim().toUpperCase();
    const q = query(collection(db, 'users'), where('studentCode', '==', targetCode), limit(1));
    const snapshot = await getDocs(q);
    trackFirestoreRead('users', snapshot.docs.length || 1);
    if (!snapshot.empty) {
      const d = snapshot.docs[0].data();
      return (d.data as User) || ({ ...d, id: snapshot.docs[0].id } as User);
    }
    return undefined;
  } catch (e) {
    console.error("Lỗi findUserByStudentCode Firestore:", e);
    return undefined;
  }
};

export const findUser = async (username: string): Promise<User | undefined> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.findUser(username);
  }
  if (!db) return undefined;
  try {
    const targetUser = username.trim().toLowerCase();
    
    // 1. Direct query by lowercase username
    const q = query(collection(db, 'users'), where('username', '==', targetUser), limit(1));
    const snapshot = await getDocs(q);
    trackFirestoreRead('users', snapshot.docs.length || 1);
    if (!snapshot.empty) {
      const d = snapshot.docs[0].data();
      return (d.data as User) || ({ ...d, id: snapshot.docs[0].id } as User);
    }

    // 2. Direct query by original username (case as typed)
    if (username.trim() !== targetUser) {
      const qOriginal = query(collection(db, 'users'), where('username', '==', username.trim()), limit(1));
      const snapOriginal = await getDocs(qOriginal);
      trackFirestoreRead('users', snapOriginal.docs.length || 1);
      if (!snapOriginal.empty) {
        const d = snapOriginal.docs[0].data();
        return (d.data as User) || ({ ...d, id: snapOriginal.docs[0].id } as User);
      }
    }

    return undefined;
  } catch (e) {
    console.error("Lỗi findUser Firestore:", e);
    return undefined;
  }
};

export const deleteUserFromFirestore = async (id: string): Promise<void> => {
  invalidateMemoryCache('users');
  if (!db) return;
  try {
    // 1. Delete associated results
    const resultsQuery = query(collection(db, 'results'), where('studentId', '==', id));
    const resultsSnap = await getDocs(resultsQuery);
    trackFirestoreRead('results', resultsSnap.docs.length);
    if (!resultsSnap.empty) {
      const batch = writeBatch(db);
      resultsSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      trackFirestoreDelete('results', resultsSnap.docs.length);
    }

    // 2. Delete user
    await deleteDoc(doc(db, 'users', id));
    trackFirestoreDelete('users', 1);
  } catch (e) {
    console.error("Lỗi deleteUser Firestore:", e);
  }
};

export const deleteUser = async (id: string): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteUser(id);
    if (isDualSyncActive()) {
      deleteUserFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deleteUserFromFirestore(id);
};

export const changePassword = async (userId: string, newPassword: string): Promise<boolean> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.changePassword(userId, newPassword);
  }
  if (!db) return false;
  try {
    let userRef = doc(db, 'users', userId);
    let docSnap = await getDoc(userRef);
    trackFirestoreRead('users', 1);
    
    if (!docSnap.exists()) {
      // Find document by id or username if doc ID didn't match directly
      const allSnapshot = await getDocs(collection(db, 'users'));
      trackFirestoreRead('users', allSnapshot.docs.length);
      const found = allSnapshot.docs.find(d => {
        const row = d.data();
        const u = (row.data as User) || (row as User);
        return d.id === userId || u.id === userId || (u.username && u.username.toLowerCase() === userId.toLowerCase());
      });
      
      if (found) {
        userRef = found.ref;
        docSnap = found;
      } else {
        console.warn("changePassword: user not found with ID", userId);
        return false;
      }
    }

    const raw = docSnap.data() || {};
    const user: User = (raw.data as User) || (raw as User);
    const updatedUser: User = { ...user, password: newPassword };
    
    await setDoc(userRef, cleanUndefined({
      ...raw,
      password: newPassword,
      data: updatedUser
    }), { merge: true });
    trackFirestoreWrite('users', 1);

    return true;
  } catch (e) {
    console.error("Lỗi changePassword:", e);
    return false;
  }
};

// --- Quizzes ---
export const getQuizzesMetadata = async (
  grade?: Grade, 
  academicYear?: string, 
  forceRefresh: boolean = false
): Promise<Quiz[]> => {
  if (isSupabasePrimary()) {
    let list = await supabaseDb.getQuizzesMetadata(grade);
    if (academicYear && academicYear !== 'all') {
      list = list.filter(q => getQuizAcademicYear(q) === academicYear);
    }
    return list;
  }
  const now = Date.now();
  if (!forceRefresh && memoryCache.quizzesMeta && memoryCache.quizzesMeta.expires > now) {
    let cached = memoryCache.quizzesMeta.data;
    if (grade && grade !== 'all') {
      cached = cached.filter(q => q.grade === grade || q.grade === 'all');
    }
    if (academicYear && academicYear !== 'all') {
      cached = cached.filter(q => getQuizAcademicYear(q) === academicYear);
    }
    return cached;
  }

  if (!db) {
    try {
      const local = localStorage.getItem('eduquiz_quizzes_meta_cache');
      if (local) {
        let parsed: Quiz[] = JSON.parse(local);
        if (grade && grade !== 'all') {
          parsed = parsed.filter(q => q.grade === grade || q.grade === 'all');
        }
        if (academicYear && academicYear !== 'all') {
          parsed = parsed.filter(q => getQuizAcademicYear(q) === academicYear);
        }
        return parsed;
      }
    } catch {}
    return [];
  }

  try {
    const qRef = collection(db, 'quizzes');
    const snapshot = await getDocs(qRef);
    trackFirestoreRead('quizzes', snapshot.docs.length);
    const quizzes = snapshot.docs.map(d => {
      const row = d.data();
      const quiz = (row.data as Quiz) || (row as Quiz);
      const computedYear = row.academicYear || quiz.academicYear || getQuizAcademicYear(quiz);
      const isShared = row.isSharedWithTeachers !== undefined 
        ? Boolean(row.isSharedWithTeachers) 
        : Boolean(quiz.isSharedWithTeachers);

      // Đếm số câu hỏi thực tế chính xác nhất từ mọi vị trí lưu trữ
      let qCount = 0;
      if (Array.isArray(row.questions) && row.questions.length > 0) {
        qCount = row.questions.length;
      } else if (Array.isArray(quiz.questions) && quiz.questions.length > 0) {
        qCount = quiz.questions.length;
      } else if (row.data && Array.isArray((row.data as any).questions) && (row.data as any).questions.length > 0) {
        qCount = (row.data as any).questions.length;
      } else if (row.questionCount !== undefined && row.questionCount !== null && typeof row.questionCount === 'number') {
        qCount = row.questionCount;
      } else if (quiz.questionCount !== undefined && quiz.questionCount !== null && typeof quiz.questionCount === 'number') {
        qCount = quiz.questionCount;
      }

      return {
        ...quiz,
        id: d.id,
        title: row.title || quiz.title || '',
        grade: row.grade || quiz.grade || '12',
        subject: row.subject || quiz.subject || '',
        academicYear: computedYear,
        type: row.type || quiz.type || 'test',
        durationMinutes: row.durationMinutes || quiz.durationMinutes || 45,
        maxAttempts: row.maxAttempts !== undefined ? row.maxAttempts : (quiz.maxAttempts !== undefined ? quiz.maxAttempts : (row.type === 'practice' || quiz.type === 'practice' ? 0 : 1)),
        startTime: row.startTime !== undefined ? (row.startTime || '') : (quiz.startTime || ''),
        endTime: row.endTime !== undefined ? (row.endTime || '') : (quiz.endTime || ''),
        showResultAnswers: row.showResultAnswers !== undefined ? Boolean(row.showResultAnswers) : (quiz.showResultAnswers !== undefined ? Boolean(quiz.showResultAnswers) : true),
        disablePractice: row.disablePractice !== undefined ? Boolean(row.disablePractice) : Boolean(quiz.disablePractice),
        category: row.category || quiz.category || '',
        orderIndex: row.orderIndex !== undefined ? row.orderIndex : (quiz.orderIndex || 0),
        createdBy: row.createdBy || quiz.createdBy || '',
        createdByName: row.createdByName || quiz.createdByName || '',
        isSharedWithTeachers: isShared,
        isPublished: row.isPublished !== undefined ? Boolean(row.isPublished) : Boolean(quiz.isPublished),
        isMonitored: row.isMonitored !== undefined ? Boolean(row.isMonitored) : Boolean(quiz.isMonitored),
        isUnlisted: row.isUnlisted !== undefined ? Boolean(row.isUnlisted) : Boolean(quiz.isUnlisted),
        targetType: row.targetType || quiz.targetType || 'all',
        assignedClassIds: row.assignedClassIds || quiz.assignedClassIds || [],
        attemptCount: row.attemptCount !== undefined ? row.attemptCount : (quiz.attemptCount || 0),
        questionCount: qCount,
        questions: []
      };
    });

    quizzes.sort((a, b) => {
      const tA = new Date(a.createdAt || 0).getTime();
      const tB = new Date(b.createdAt || 0).getTime();
      return tB - tA;
    });

    memoryCache.quizzesMeta = { data: quizzes, expires: now + 5 * 60 * 1000 };
    try {
      localStorage.setItem('eduquiz_quizzes_meta_cache', JSON.stringify(quizzes));
    } catch {}

    let filtered = quizzes;
    if (grade && grade !== 'all') {
      filtered = filtered.filter(q => q.grade === grade || q.grade === 'all');
    }
    if (academicYear && academicYear !== 'all') {
      filtered = filtered.filter(q => getQuizAcademicYear(q) === academicYear);
    }
    return filtered;
  } catch (e) {
    console.error("Lỗi getQuizzesMetadata:", e);
    try {
      const local = localStorage.getItem('eduquiz_quizzes_meta_cache');
      if (local) {
        let parsed: Quiz[] = JSON.parse(local);
        if (grade && grade !== 'all') {
          parsed = parsed.filter(q => q.grade === grade || q.grade === 'all');
        }
        if (academicYear && academicYear !== 'all') {
          parsed = parsed.filter(q => getQuizAcademicYear(q) === academicYear);
        }
        return parsed;
      }
    } catch {}
    return [];
  }
};

export const getQuizzesMetadataPage = async (
  page: number, 
  pageSize: number = 20, 
  grade?: Grade,
  academicYear?: string,
  forceRefresh: boolean = false
): Promise<{ data: Quiz[]; total: number }> => {
  const allQuizzes = await getQuizzesMetadata(grade, academicYear, forceRefresh);
  const total = allQuizzes.length;
  const from = (page - 1) * pageSize;
  const paged = allQuizzes.slice(from, from + pageSize);
  return { data: paged, total };
};

export const getQuizzes = async (grade?: Grade): Promise<Quiz[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getQuizzes(grade);
  }
  if (!db) return [];
  try {
    const qRef = collection(db, 'quizzes');
    let q = query(qRef);
    if (grade && grade !== 'all') {
      q = query(qRef, where('grade', 'in', [grade, 'all']));
    }
    const snapshot = await getDocs(q);
    trackFirestoreRead('quizzes', snapshot.docs.length);
    return snapshot.docs.map(d => {
      const row = d.data();
      const quiz = (row.data as Quiz) || (row as Quiz);
      let qs: Question[] = [];
      if (Array.isArray(quiz.questions) && quiz.questions.length > 0) {
        qs = quiz.questions;
      } else if (Array.isArray(row.questions) && row.questions.length > 0) {
        qs = row.questions;
      } else if (row.data && Array.isArray((row.data as any).questions)) {
        qs = (row.data as any).questions;
      }
      return {
        ...quiz,
        ...row,
        id: d.id,
        questions: qs,
        questionCount: qs.length > 0 ? qs.length : (row.questionCount || quiz.questionCount || 0),
        academicYear: row.academicYear || quiz.academicYear || getQuizAcademicYear(quiz)
      };
    });
  } catch (e) {
    return [];
  }
};

export const getQuizById = async (id: string, forceRefresh: boolean = false): Promise<Quiz | null> => {
  if (!id) return null;
  const now = Date.now();
  if (!forceRefresh && memoryCache.quizDetails?.has(id)) {
    const cached = memoryCache.quizDetails.get(id);
    if (cached && cached.expires > now && cached.data?.questions && cached.data.questions.length > 0) {
      return cached.data;
    }
  }

  // Check localStorage cache first - CHỈ DÙNG CACHE NẾU THỰC SỰ CÓ CÂU HỎI
  if (!forceRefresh) {
    try {
      const localCacheKey = `eduquiz_quiz_detail_${id}`;
      const local = localStorage.getItem(localCacheKey);
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && parsed.data && parsed.expires > now && Array.isArray(parsed.data.questions) && parsed.data.questions.length > 0) {
          if (!memoryCache.quizDetails) memoryCache.quizDetails = new Map();
          memoryCache.quizDetails.set(id, { data: parsed.data, expires: parsed.expires });
          return parsed.data;
        }
      }
    } catch (e) {}
  }

  if (isSupabasePrimary()) {
    const sbQuiz = await supabaseDb.getQuizById(id);
    if (sbQuiz && Array.isArray(sbQuiz.questions) && sbQuiz.questions.length > 0) {
      if (!memoryCache.quizDetails) memoryCache.quizDetails = new Map();
      const expires = now + 15 * 60 * 1000; // 15 phút cache
      memoryCache.quizDetails.set(id, { data: sbQuiz, expires });
      try {
        localStorage.setItem(`eduquiz_quiz_detail_${id}`, JSON.stringify({ data: sbQuiz, expires }));
      } catch (e) {}
    }
    return sbQuiz;
  }

  if (!db) return null;
  try {
    const docSnap = await getDoc(doc(db, 'quizzes', id));
    trackFirestoreRead('quizzes', 1);
    if (!docSnap.exists()) return null;
    const data = docSnap.data();
    const rawData = (data.data as Quiz) || {};
    const quiz = (typeof data.data === 'object' && data.data !== null) ? (data.data as Quiz) : (data as Quiz);

    // Thu thập câu hỏi từ mọi nguồn có thể có trong document Firestore (cả data.questions, quiz.questions, và rawData.questions)
    let extractedQuestions: Question[] = [];
    if (Array.isArray(quiz.questions) && quiz.questions.length > 0) {
      extractedQuestions = quiz.questions;
    } else if (Array.isArray(data.questions) && data.questions.length > 0) {
      extractedQuestions = data.questions;
    } else if (data.data && Array.isArray((data.data as any).questions) && (data.data as any).questions.length > 0) {
      extractedQuestions = (data.data as any).questions;
    }

    // Nếu đề thi được lưu dạng chunked (do dung lượng lớn), tải câu hỏi từ subcollection 'chunks'
    if (extractedQuestions.length === 0 && (data.isChunked || data.chunkCount)) {
      try {
        const chunksSnap = await getDocs(collection(db, 'quizzes', id, 'chunks'));
        if (!chunksSnap.empty) {
          const sorted = chunksSnap.docs
            .map(d => d.data() as { index: number; questions: Question[] })
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          extractedQuestions = sorted.flatMap(c => c.questions || []);
        }
      } catch (err) {
        console.error("Lỗi tải chunks câu hỏi đề thi:", err);
      }
    }

    const isShared = data.isSharedWithTeachers !== undefined 
      ? Boolean(data.isSharedWithTeachers) 
      : Boolean(quiz.isSharedWithTeachers);

    const actualQuestionCount = extractedQuestions.length > 0 
      ? extractedQuestions.length 
      : (data.questionCount !== undefined ? data.questionCount : (quiz.questionCount || 0));

    const resultQuiz: Quiz = {
      ...quiz,
      id: docSnap.id,
      title: data.title || quiz.title || '',
      grade: data.grade || quiz.grade || '12',
      subject: data.subject || quiz.subject || '',
      academicYear: data.academicYear || quiz.academicYear || getQuizAcademicYear(quiz),
      type: data.type || quiz.type || 'test',
      durationMinutes: data.durationMinutes || quiz.durationMinutes || 45,
      maxAttempts: data.maxAttempts !== undefined ? data.maxAttempts : (quiz.maxAttempts !== undefined ? quiz.maxAttempts : (data.type === 'practice' || quiz.type === 'practice' ? 0 : 1)),
      startTime: data.startTime !== undefined ? (data.startTime || '') : (quiz.startTime || ''),
      endTime: data.endTime !== undefined ? (data.endTime || '') : (quiz.endTime || ''),
      showResultAnswers: data.showResultAnswers !== undefined ? Boolean(data.showResultAnswers) : (quiz.showResultAnswers !== undefined ? Boolean(quiz.showResultAnswers) : true),
      disablePractice: data.disablePractice !== undefined ? Boolean(data.disablePractice) : Boolean(quiz.disablePractice),
      category: data.category || quiz.category || '',
      orderIndex: data.orderIndex !== undefined ? data.orderIndex : (quiz.orderIndex || 0),
      createdBy: data.createdBy || quiz.createdBy || '',
      createdByName: data.createdByName || quiz.createdByName || '',
      isSharedWithTeachers: isShared,
      isPublished: data.isPublished !== undefined ? Boolean(data.isPublished) : Boolean(quiz.isPublished),
      isMonitored: data.isMonitored !== undefined ? Boolean(data.isMonitored) : Boolean(quiz.isMonitored),
      isUnlisted: data.isUnlisted !== undefined ? Boolean(data.isUnlisted) : Boolean(quiz.isUnlisted),
      targetType: data.targetType || quiz.targetType || 'all',
      assignedClassIds: data.assignedClassIds || quiz.assignedClassIds || [],
      questions: extractedQuestions,
      questionCount: actualQuestionCount,
      attemptCount: data.attemptCount !== undefined ? data.attemptCount : (quiz.attemptCount || 0)
    };

    // Chỉ cache nếu câu hỏi thực sự đã được tải thành công
    if (extractedQuestions.length > 0) {
      if (!memoryCache.quizDetails) memoryCache.quizDetails = new Map();
      const expires = now + 10 * 60 * 1000; // 10 minutes cache
      memoryCache.quizDetails.set(id, { data: resultQuiz, expires });

      try {
        localStorage.setItem(`eduquiz_quiz_detail_${id}`, JSON.stringify({ data: resultQuiz, expires }));
      } catch (e) {}
    }

    return resultQuiz;
  } catch (e) {
    console.error("Lỗi getQuizById:", e);
    return null;
  }
};

// Helper to compress and convert image file / blob to an optimized JPEG Base64 / Blob
export const compressImageFile = async (
  file: File | Blob, 
  maxWidth: number = 850, 
  maxHeight: number = 850, 
  quality: number = 0.8
): Promise<{ dataUrl: string; blob: Blob }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve({
            dataUrl: (e.target?.result as string) || '',
            blob: file as Blob
          });
        }

        // Đổ nền trắng trước khi vẽ để ảnh PNG trong suốt không bị biến thành màu đen khi đổi sang JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Xuất ra định dạng JPEG nén chuẩn (giảm dung lượng từ ~600KB PNG xuống chỉ còn ~25-40KB)
        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        canvas.toBlob(
          (blob) => {
            resolve({
              dataUrl,
              blob: blob || (file as Blob)
            });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => {
        resolve({
          dataUrl: (e.target?.result as string) || '',
          blob: file as Blob
        });
      };
      img.src = (e.target?.result as string) || '';
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};

// Nén chuỗi ảnh Base64 sẵn có trong câu hỏi đề thi (giải phóng dung lượng vượt giới hạn 1MB của Firestore)
export const compressBase64Image = async (
  dataUrl: string, 
  maxWidth: number = 850, 
  maxHeight: number = 850, 
  quality: number = 0.8
): Promise<string> => {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
  // Nếu đã là JPEG nhỏ (< 40KB) thì không cần nén lại
  if (dataUrl.startsWith('data:image/jpeg') && dataUrl.length < 40 * 1024) return dataUrl;

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(dataUrl);

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const compressed = canvas.toDataURL('image/jpeg', quality);
          // Chỉ lấy ảnh nén nếu dung lượng thực sự nhỏ hơn ảnh gốc
          if (compressed && compressed.length < dataUrl.length) {
            resolve(compressed);
          } else {
            resolve(dataUrl);
          }
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
};

// Quét toàn bộ câu hỏi và nén mọi ảnh Base64 trước khi ghi vào Cloud Firestore
export const optimizeQuizQuestions = async (questions: Question[]): Promise<Question[]> => {
  if (!questions || !Array.isArray(questions)) return [];
  return Promise.all(
    questions.map(async (q) => {
      let updatedQ = { ...q };
      if (updatedQ.imageUrl && updatedQ.imageUrl.startsWith('data:image/')) {
        updatedQ.imageUrl = await compressBase64Image(updatedQ.imageUrl, 850, 850, 0.8);
      }
      return updatedQ;
    })
  );
};

export const saveQuizToFirestore = async (enrichedQuiz: Quiz): Promise<void> => {
  if (!db) return;
  const effectiveYear = enrichedQuiz.academicYear || getQuizAcademicYear(enrichedQuiz);
  const qList = enrichedQuiz.questions || [];
  const { questions: _unusedQuestions, data: _unusedData, ...metaOnly } = enrichedQuiz as any;

  const payload: any = {
    id: enrichedQuiz.id,
    title: enrichedQuiz.title || '',
    grade: enrichedQuiz.grade || '12',
    type: enrichedQuiz.type || 'test',
    category: enrichedQuiz.category || '',
    subject: enrichedQuiz.subject || '',
    academicYear: effectiveYear,
    isPublished: enrichedQuiz.isPublished ?? false,
    isMonitored: enrichedQuiz.isMonitored || false,
    isUnlisted: enrichedQuiz.isUnlisted || false,
    disablePractice: enrichedQuiz.disablePractice || false,
    showResultAnswers: enrichedQuiz.showResultAnswers !== false,
    durationMinutes: enrichedQuiz.durationMinutes || 45,
    orderIndex: enrichedQuiz.orderIndex || 0,
    startTime: normalizeDateTimeForStorage(enrichedQuiz.startTime),
    endTime: normalizeDateTimeForStorage(enrichedQuiz.endTime),
    createdBy: enrichedQuiz.createdBy || '',
    createdByName: enrichedQuiz.createdByName || '',
    isSharedWithTeachers: enrichedQuiz.isSharedWithTeachers ?? false,
    targetType: enrichedQuiz.targetType || 'all',
    assignedClassIds: enrichedQuiz.assignedClassIds || [],
    questionCount: enrichedQuiz.questionCount,
    attemptCount: enrichedQuiz.attemptCount || 0,
    createdAt: enrichedQuiz.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data: cleanUndefined(metaOnly),
    questions: qList,
    isChunked: false,
    chunkCount: 0
  };

  const estimatedSize = new Blob([JSON.stringify(payload)]).size;
  const FIRESTORE_SAFE_LIMIT = 750 * 1024; // 750 KB

  if (estimatedSize > FIRESTORE_SAFE_LIMIT) {
    const CHUNK_SIZE = 15;
    const chunks: Question[][] = [];
    for (let i = 0; i < qList.length; i += CHUNK_SIZE) {
      chunks.push(qList.slice(i, i + CHUNK_SIZE));
    }

    payload.isChunked = true;
    payload.chunkCount = chunks.length;
    payload.questions = [];

    await setDoc(doc(db, 'quizzes', enrichedQuiz.id), cleanUndefined(payload));

    const batch = writeBatch(db);
    chunks.forEach((chunk, idx) => {
      const chunkRef = doc(db, 'quizzes', enrichedQuiz.id, 'chunks', `chunk_${idx}`);
      batch.set(chunkRef, { index: idx, questions: cleanUndefined(chunk) });
    });
    await batch.commit();
  } else {
    await setDoc(doc(db, 'quizzes', enrichedQuiz.id), cleanUndefined(payload));
  }

  if (memoryCache.quizDetails) memoryCache.quizDetails.delete(enrichedQuiz.id);
  try {
    localStorage.removeItem(`eduquiz_quiz_detail_${enrichedQuiz.id}`);
  } catch {}
  invalidateMemoryCache('quizzes');
  trackFirestoreWrite('quizzes', 1);
};

export const saveQuiz = async (quiz: Quiz): Promise<void> => {
  const rawQList = quiz.questions || [];
  const qList = await optimizeQuizQuestions(rawQList);
  const enrichedQuiz = { 
    ...quiz, 
    academicYear: quiz.academicYear || getQuizAcademicYear(quiz),
    questions: qList,
    questionCount: qList.length 
  };

  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveQuiz(enrichedQuiz);
    if (memoryCache.quizDetails) memoryCache.quizDetails.delete(enrichedQuiz.id);
    try {
      localStorage.removeItem(`eduquiz_quiz_detail_${enrichedQuiz.id}`);
    } catch {}
    invalidateMemoryCache('quizzes');
    if (isDualSyncActive()) {
      saveQuizToFirestore(enrichedQuiz).catch((err) => {
        console.warn("Dual sync quiz to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveQuizToFirestore(enrichedQuiz);
};

export const updateQuiz = async (enrichedQuiz: Quiz): Promise<void> => {
  if (isSupabasePrimary()) {
    return await saveQuiz(enrichedQuiz);
  }
  if (!db) throw new Error("Mất kết nối Database Cloud Firestore");
  const effectiveYear = enrichedQuiz.academicYear || getQuizAcademicYear(enrichedQuiz);
  const rawQList = enrichedQuiz.questions || [];
  
  // Tự động nén ảnh Base64 trong câu hỏi (nếu có)
  const qList = await optimizeQuizQuestions(rawQList);
  const quiz = { 
    ...enrichedQuiz, 
    academicYear: effectiveYear,
    questions: qList,
    questionCount: qList.length 
  };

  // Tách biệt metadata và questions để KHÔNG lưu trùng lặp danh sách câu hỏi 2 lần trong cùng 1 document
  const { questions: _unusedQuestions, data: _unusedData, ...metaOnly } = quiz as any;

  const payload: any = {
    id: quiz.id,
    title: quiz.title || '',
    grade: quiz.grade || '12',
    type: quiz.type || 'test',
    category: quiz.category || '',
    subject: quiz.subject || '',
    academicYear: effectiveYear,
    isPublished: quiz.isPublished ?? false,
    isMonitored: quiz.isMonitored || false,
    isUnlisted: quiz.isUnlisted || false,
    disablePractice: quiz.disablePractice || false,
    showResultAnswers: quiz.showResultAnswers !== false,
    durationMinutes: quiz.durationMinutes || 45,
    orderIndex: quiz.orderIndex || 0,
    startTime: normalizeDateTimeForStorage(quiz.startTime),
    endTime: normalizeDateTimeForStorage(quiz.endTime),
    createdBy: quiz.createdBy || '',
    createdByName: quiz.createdByName || '',
    isSharedWithTeachers: quiz.isSharedWithTeachers ?? false,
    targetType: quiz.targetType || 'all',
    assignedClassIds: quiz.assignedClassIds || [],
    questionCount: quiz.questionCount,
    attemptCount: quiz.attemptCount || 0,
    updatedAt: new Date().toISOString(),
    // Chỉ lưu metadata vào data, KHÔNG bao gồm mảng questions để tiết kiệm 50% dung lượng
    data: cleanUndefined(metaOnly),
    questions: qList,
    isChunked: false,
    chunkCount: 0
  };

  // Tính toán dung lượng document (Firestore giới hạn tối đa 1,048,576 bytes ~ 1MB)
  const estimatedSize = new Blob([JSON.stringify(payload)]).size;
  const FIRESTORE_SAFE_LIMIT = 750 * 1024; // 750 KB ngưỡng an toàn

  if (estimatedSize > FIRESTORE_SAFE_LIMIT) {
    // Đề thi lớn: Tự động chia nhỏ (chunk) câu hỏi sang subcollection
    const CHUNK_SIZE = 15;
    const chunks: Question[][] = [];
    for (let i = 0; i < qList.length; i += CHUNK_SIZE) {
      chunks.push(qList.slice(i, i + CHUNK_SIZE));
    }

    payload.isChunked = true;
    payload.chunkCount = chunks.length;
    payload.questions = []; // Root document chỉ giữ metadata

    // Ghi đè root doc mà không dùng { merge: true } để dọn dẹp triệt để dữ liệu cũ phình to
    await setDoc(doc(db, 'quizzes', quiz.id), cleanUndefined(payload));

    // Lưu các chunks vào subcollection 'chunks'
    const batch = writeBatch(db);
    chunks.forEach((chunk, idx) => {
      const chunkRef = doc(db, 'quizzes', quiz.id, 'chunks', `chunk_${idx}`);
      batch.set(chunkRef, { index: idx, questions: cleanUndefined(chunk) });
    });
    await batch.commit();
  } else {
    // Kích thước an toàn: Ghi đè document (loại bỏ hoàn toàn duplicate data.questions cũ gây lỗi 1MB)
    await setDoc(doc(db, 'quizzes', quiz.id), cleanUndefined(payload));

    // Nếu trước đó từng dùng subcollection chunks, dọn dẹp các chunks thừa
    try {
      const oldChunks = await getDocs(collection(db, 'quizzes', quiz.id, 'chunks'));
      if (!oldChunks.empty) {
        const delBatch = writeBatch(db);
        oldChunks.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
      }
    } catch {}
  }

  if (memoryCache.quizDetails) memoryCache.quizDetails.delete(quiz.id);
  try {
    localStorage.removeItem(`eduquiz_quiz_detail_${quiz.id}`);
  } catch {}
  invalidateMemoryCache('quizzes');
  try {
    localStorage.removeItem('eduquiz_quizzes_meta_cache');
  } catch {}
  trackFirestoreWrite('quizzes', 1);
};

export const updateQuizAcademicYear = async (quizId: string, academicYear: string): Promise<void> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.updateQuizAcademicYear(quizId, academicYear);
  }
  if (!db) throw new Error("Mất kết nối Database Cloud Firestore");
  const quizRef = doc(db, 'quizzes', quizId);
  await updateDoc(quizRef, {
    academicYear: academicYear,
    'data.academicYear': academicYear
  });
  
  // Cập nhật ngay trong MemoryCache và localStorage để không tốn read
  if (memoryCache.quizzesMeta?.data) {
    memoryCache.quizzesMeta.data = memoryCache.quizzesMeta.data.map(q => 
      q.id === quizId ? { ...q, academicYear } : q
    );
    try {
      localStorage.setItem('eduquiz_quizzes_meta_cache', JSON.stringify(memoryCache.quizzesMeta.data));
    } catch {}
  }
  trackFirestoreWrite('quizzes', 1);
};

export const updateQuizShareStatus = async (quizId: string, isShared: boolean): Promise<void> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.updateQuizShareStatus(quizId, isShared);
  }
  if (!db) throw new Error("Mất kết nối Database Cloud Firestore");
  const quizRef = doc(db, 'quizzes', quizId);
  await updateDoc(quizRef, {
    isSharedWithTeachers: Boolean(isShared),
    'data.isSharedWithTeachers': Boolean(isShared)
  });
  
  // Cập nhật ngay lập tức trong MemoryCache và localStorage
  if (memoryCache.quizzesMeta?.data) {
    memoryCache.quizzesMeta.data = memoryCache.quizzesMeta.data.map(q => 
      q.id === quizId ? { ...q, isSharedWithTeachers: Boolean(isShared) } : q
    );
    try {
      localStorage.setItem('eduquiz_quizzes_meta_cache', JSON.stringify(memoryCache.quizzesMeta.data));
    } catch {}
  }
  
  if (memoryCache.quizDetails?.has(quizId)) {
    const cached = memoryCache.quizDetails.get(quizId)!;
    memoryCache.quizDetails.set(quizId, {
      ...cached,
      data: { ...cached.data, isSharedWithTeachers: Boolean(isShared) }
    });
  }

  try {
    const localDetailKey = `eduquiz_quiz_detail_${quizId}`;
    const localStr = localStorage.getItem(localDetailKey);
    if (localStr) {
      const parsed = JSON.parse(localStr);
      if (parsed?.data) {
        parsed.data.isSharedWithTeachers = Boolean(isShared);
        localStorage.setItem(localDetailKey, JSON.stringify(parsed));
      }
    }
  } catch {}

  trackFirestoreWrite('quizzes', 1);
};

export const updateQuizSchedule = async (quizId: string, startTime: string | null, endTime: string | null): Promise<void> => {
  const cleanStartTime = normalizeDateTimeForStorage(startTime);
  const cleanEndTime = normalizeDateTimeForStorage(endTime);

  if (isSupabasePrimary()) {
    await supabaseDb.updateQuizSchedule(quizId, cleanStartTime, cleanEndTime);
  }
  if (db) {
    const quizRef = doc(db, 'quizzes', quizId);
    await updateDoc(quizRef, {
      startTime: cleanStartTime,
      endTime: cleanEndTime,
      'data.startTime': cleanStartTime,
      'data.endTime': cleanEndTime,
      updatedAt: new Date().toISOString()
    });
    trackFirestoreWrite('quizzes', 1);
  }

  // Cập nhật ngay lập tức trong MemoryCache và localStorage
  if (memoryCache.quizzesMeta?.data) {
    memoryCache.quizzesMeta.data = memoryCache.quizzesMeta.data.map(q => 
      q.id === quizId ? { ...q, startTime: cleanStartTime || '', endTime: cleanEndTime || '' } : q
    );
    try {
      localStorage.setItem('eduquiz_quizzes_meta_cache', JSON.stringify(memoryCache.quizzesMeta.data));
    } catch {}
  }

  if (memoryCache.quizDetails?.has(quizId)) {
    const cached = memoryCache.quizDetails.get(quizId)!;
    memoryCache.quizDetails.set(quizId, {
      ...cached,
      data: { ...cached.data, startTime: cleanStartTime || '', endTime: cleanEndTime || '' }
    });
  }

  try {
    const localDetailKey = `eduquiz_quiz_detail_${quizId}`;
    const localStr = localStorage.getItem(localDetailKey);
    if (localStr) {
      const parsed = JSON.parse(localStr);
      if (parsed?.data) {
        parsed.data.startTime = cleanStartTime || '';
        parsed.data.endTime = cleanEndTime || '';
        localStorage.setItem(localDetailKey, JSON.stringify(parsed));
      }
    }
  } catch {}
};

export const assignQuizToClasses = async (
  quizId: string, 
  assignedClassIds: string[], 
  teacherManagedClassIds?: string[]
): Promise<{ finalClassIds: string[]; targetType: string }> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.assignQuizToClasses(quizId, assignedClassIds, teacherManagedClassIds);
  }
  if (!db) throw new Error("Mất kết nối Database Cloud Firestore");
  const quizRef = doc(db, 'quizzes', quizId);
  const docSnap = await getDoc(quizRef);
  trackFirestoreRead('quizzes', 1);
  if (!docSnap.exists()) throw new Error("Không tìm thấy đề thi trên Cloud");
  
  const raw = docSnap.data();
  const quiz = (raw.data as Quiz) || (raw as Quiz);
  const qList = (Array.isArray(quiz.questions) && quiz.questions.length > 0) 
    ? quiz.questions 
    : (Array.isArray(raw.questions) ? raw.questions : []);
  
  let finalClassIds: string[] = [];
  if (teacherManagedClassIds && teacherManagedClassIds.length > 0) {
    // Giữ nguyên các lớp do các giáo viên khác đã giao trước đó
    const otherTeacherClassIds = (quiz.assignedClassIds || []).filter(id => !teacherManagedClassIds.includes(id));
    finalClassIds = Array.from(new Set([...otherTeacherClassIds, ...assignedClassIds]));
  } else {
    finalClassIds = assignedClassIds;
  }
  
  const targetType = finalClassIds.length > 0 ? 'classes' : (quiz.targetType || 'classes');

  // Chỉ cập nhật targetType và assignedClassIds mà KHÔNG serialize lại toàn bộ mảng questions
  await updateDoc(quizRef, {
    targetType,
    assignedClassIds: finalClassIds,
    'data.targetType': targetType,
    'data.assignedClassIds': finalClassIds
  });

  // Update in memory cache and local storage in-place instead of invalidating and refetching all
  if (memoryCache.quizzesMeta?.data) {
    memoryCache.quizzesMeta.data = memoryCache.quizzesMeta.data.map(q => 
      q.id === quizId ? { ...q, targetType: targetType as any, assignedClassIds: finalClassIds } : q
    );
    try {
      localStorage.setItem('eduquiz_quizzes_meta_cache', JSON.stringify(memoryCache.quizzesMeta.data));
    } catch {}
  }
  
  trackFirestoreWrite('quizzes', 1);
  return { finalClassIds, targetType };
};

export const deleteQuizFromFirestore = async (id: string): Promise<void> => {
  if (!db) return;
  try {
    const chunksSnap = await getDocs(collection(db, 'quizzes', id, 'chunks'));
    if (!chunksSnap.empty) {
      const batch = writeBatch(db);
      chunksSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch {}
  await deleteDoc(doc(db, 'quizzes', id));
  invalidateMemoryCache('quizzes');
  trackFirestoreDelete('quizzes', 1);
};

export const deleteQuiz = async (id: string): Promise<void> => {
  if (memoryCache.quizDetails) memoryCache.quizDetails.delete(id);
  try {
    localStorage.removeItem(`eduquiz_quiz_detail_${id}`);
  } catch {}
  invalidateMemoryCache('quizzes');
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteQuiz(id);
    if (isDualSyncActive()) {
      deleteQuizFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deleteQuizFromFirestore(id);
};

export const syncAllQuizzesMetadata = async (): Promise<number> => {
  if (!db) return 0;
  try {
    const snapshot = await getDocs(collection(db, 'quizzes'));
    trackFirestoreRead('quizzes', snapshot.docs.length);
    let count = 0;
    const batch = writeBatch(db);
    for (const docItem of snapshot.docs) {
      const row = docItem.data();
      const quiz = (row.data as Quiz) || (row as Quiz);
      let qs: Question[] = [];
      if (Array.isArray(quiz.questions) && quiz.questions.length > 0) {
        qs = quiz.questions;
      } else if (Array.isArray(row.questions) && row.questions.length > 0) {
        qs = row.questions;
      } else if (row.data && Array.isArray((row.data as any).questions)) {
        qs = (row.data as any).questions;
      }
      const questionCount = qs.length > 0 ? qs.length : (row.questionCount || quiz.questionCount || 0);
      const updatedQuiz = { ...quiz, questions: qs, questionCount };
      batch.update(docItem.ref, {
        questionCount,
        questions: qs,
        data: cleanUndefined(updatedQuiz)
      });
      count++;
    }
    await batch.commit();
    trackFirestoreWrite('quizzes', count);
    return count;
  } catch (e) {
    console.error("Lỗi đồng bộ Metadata Firestore:", e);
    return 0;
  }
};

// --- Chapters ---
export const getChapters = async (forceRefresh: boolean = false): Promise<Chapter[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getChapters();
  }
  if (!db) return [];
  const now = Date.now();
  if (!forceRefresh && memoryCache.chapters && memoryCache.chapters.expires > now) {
    return memoryCache.chapters.data;
  }

  try {
    const snapshot = await getDocs(collection(db, 'chapters'));
    trackFirestoreRead('chapters', snapshot.docs.length);
    const chapters = snapshot.docs.map(d => {
      const row = d.data();
      const rawData = (row.data as Partial<Chapter>) || {};
      return {
        ...rawData,
        ...row,
        id: d.id,
        name: rawData.name || row.name || (row as any).title || '',
        grade: (rawData.grade || row.grade || '12') as Grade,
        subject: rawData.subject || row.subject || '',
        order: rawData.order ?? row.order ?? 0,
        createdBy: rawData.createdBy || row.createdBy || '',
        createdByName: rawData.createdByName || row.createdByName || ''
      } as Chapter;
    });
    const sorted = chapters.sort((a, b) => (a.order || 0) - (b.order || 0));
    memoryCache.chapters = { data: sorted, expires: now + 5 * 60 * 1000 };
    return sorted;
  } catch (e) {
    console.error("Lỗi getChapters:", e);
    return memoryCache.chapters?.data || [];
  }
};

export const saveChapterToFirestore = async (c: Chapter): Promise<void> => {
  if (db) {
    invalidateMemoryCache('chapters');
    await setDoc(doc(db, 'chapters', c.id), cleanUndefined({
      id: c.id,
      grade: c.grade,
      name: c.name,
      order: c.order,
      subject: c.subject || '',
      createdBy: c.createdBy || '',
      createdByName: c.createdByName || '',
      data: cleanUndefined(c)
    }));
    trackFirestoreWrite('chapters', 1);
  }
};

export const saveChapter = async (c: Chapter): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveChapter(c);
    if (isDualSyncActive()) {
      saveChapterToFirestore(c).catch((err) => {
        console.warn("Dual sync chapter to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveChapterToFirestore(c);
};

export const deleteChapterFromFirestore = async (id: string): Promise<void> => {
  if (db) {
    invalidateMemoryCache('chapters');
    await deleteDoc(doc(db, 'chapters', id));
    trackFirestoreDelete('chapters', 1);
  }
};

export const deleteChapter = async (id: string): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteChapter(id);
    if (isDualSyncActive()) {
      deleteChapterFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deleteChapterFromFirestore(id);
};

export const deleteChaptersBatchFromFirestore = async (ids: string[]): Promise<void> => {
  if (!db || ids.length === 0) return;
  invalidateMemoryCache('chapters');
  const batch = writeBatch(db);
  for (const id of ids) {
    batch.delete(doc(db, 'chapters', id));
  }
  await batch.commit();
  trackFirestoreDelete('chapters', ids.length);
};

export const deleteChaptersBatch = async (ids: string[]): Promise<void> => {
  if (isSupabasePrimary()) {
    for (const id of ids) {
      await supabaseDb.deleteChapter(id);
    }
    if (isDualSyncActive()) {
      deleteChaptersBatchFromFirestore(ids).catch(() => {});
    }
    return;
  }
  return await deleteChaptersBatchFromFirestore(ids);
};

// --- Classroom & Academic Year Management ---
export const getClasses = async (forceRefresh: boolean = false): Promise<ClassRoom[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getClasses();
  }
  if (db) {
    const now = Date.now();
    if (!forceRefresh && memoryCache.classes && memoryCache.classes.expires > now) {
      return memoryCache.classes.data;
    }

    try {
      const snapshot = await getDocs(collection(db, 'classes'));
      trackFirestoreRead('classes', snapshot.docs.length);
      if (!snapshot.empty) {
        const classes = snapshot.docs.map(d => {
          const row = d.data();
          const parsed = (row.data as ClassRoom) || ({
            id: d.id,
            name: row.name || '',
            academicYear: row.academicYear || row.academic_year || '',
            grade: row.grade || '12',
            subject: row.subject || undefined,
            description: row.description || '',
            createdBy: row.createdBy || '',
            teacherName: row.teacherName || '',
            isSharedWithTeachers: row.isSharedWithTeachers || false,
            studentCount: row.studentCount ?? row.student_count ?? undefined
          } as ClassRoom);
          return {
            ...parsed,
            id: d.id,
            subject: parsed.subject || row.subject || undefined,
            createdBy: parsed.createdBy || row.createdBy || '',
            teacherName: parsed.teacherName || row.teacherName || '',
            isSharedWithTeachers: parsed.isSharedWithTeachers ?? row.isSharedWithTeachers ?? false,
            studentCount: parsed.studentCount ?? row.studentCount ?? row.student_count ?? undefined
          };
        });

        memoryCache.classes = { data: classes, expires: now + 5 * 60 * 1000 };

        try {
          localStorage.setItem('eduquiz_classes_cache', JSON.stringify(classes));
        } catch (e) {}

        return classes;
      }
    } catch (e) {
      console.warn("Lỗi đọc classes từ Firestore, fallback sang cache:", e);
    }
  }

  // Fallback to localStorage
  if (memoryCache.classes?.data) return memoryCache.classes.data;
  try {
    const local = localStorage.getItem('eduquiz_classes_cache');
    if (local) return JSON.parse(local);
  } catch (e) {}
  return [];
};

export const saveClassToFirestore = async (c: ClassRoom): Promise<void> => {
  invalidateMemoryCache('classes');
  try {
    const list = await getClasses();
    const idx = list.findIndex(item => item.id === c.id);
    if (idx >= 0) list[idx] = c;
    else list.push(c);
    localStorage.setItem('eduquiz_classes_cache', JSON.stringify(list));
  } catch (e) {}

  if (db) {
    await setDoc(doc(db, 'classes', c.id), cleanUndefined({
      id: c.id,
      name: c.name,
      academicYear: c.academicYear,
      grade: c.grade,
      subject: c.subject || '',
      description: c.description || '',
      createdBy: c.createdBy || '',
      teacherName: c.teacherName || '',
      isSharedWithTeachers: Boolean(c.isSharedWithTeachers),
      studentCount: typeof c.studentCount === 'number' ? c.studentCount : null,
      data: cleanUndefined(c)
    }));
    trackFirestoreWrite('classes', 1);
  }
};

export const saveClass = async (c: ClassRoom): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveClass(c);
    if (isDualSyncActive()) {
      saveClassToFirestore(c).catch((err) => {
        console.warn("Dual sync class to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveClassToFirestore(c);
};

export const saveClassesBatchToFirestore = async (classesList: ClassRoom[]): Promise<void> => {
  if (classesList.length === 0) return;
  invalidateMemoryCache('classes');
  try {
    localStorage.setItem('eduquiz_classes_cache', JSON.stringify(classesList));
  } catch (e) {}

  if (db) {
    const batch = writeBatch(db);
    for (const c of classesList) {
      batch.set(doc(db, 'classes', c.id), cleanUndefined({
        id: c.id,
        name: c.name,
        academicYear: c.academicYear,
        grade: c.grade,
        description: c.description || '',
        createdBy: c.createdBy || '',
        teacherName: c.teacherName || '',
        isSharedWithTeachers: Boolean(c.isSharedWithTeachers),
        data: cleanUndefined(c)
      }));
    }
    await batch.commit();
    trackFirestoreWrite('classes', classesList.length);
  }
};

export const saveClassesBatch = async (classesList: ClassRoom[]): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveClassesBatch(classesList);
    if (isDualSyncActive()) {
      saveClassesBatchToFirestore(classesList).catch((err) => {
        console.warn("Dual sync classes batch to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveClassesBatchToFirestore(classesList);
};

export const deleteClassFromFirestore = async (id: string): Promise<void> => {
  invalidateMemoryCache('classes');
  try {
    const list = await getClasses();
    const updated = list.filter(item => item.id !== id);
    localStorage.setItem('eduquiz_classes_cache', JSON.stringify(updated));
  } catch (e) {}

  if (db) {
    await deleteDoc(doc(db, 'classes', id));
    trackFirestoreDelete('classes', 1);
  }
};

export const deleteClass = async (id: string): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteClass(id);
    if (isDualSyncActive()) {
      deleteClassFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deleteClassFromFirestore(id);
};

export const assignStudentsToClass = async (
  studentIds: string[], 
  classInfo: { classId?: string; className?: string; academicYear?: string; grade?: Grade; subject?: string } | null
): Promise<number> => {
  if (!db || studentIds.length === 0) return 0;
  try {
    const allUsers = await getUsers();
    const targetUsers = allUsers.filter(u => studentIds.includes(u.id));

    const updatedUsers: User[] = targetUsers.map(u => ({
      ...u,
      classId: classInfo?.classId || '',
      className: classInfo?.className || '',
      academicYear: classInfo?.academicYear || '',
      grade: classInfo?.grade || u.grade,
      subject: classInfo?.subject || u.subject || ''
    }));

    await saveUsersBatch(updatedUsers);
    return updatedUsers.length;
  } catch (e) {
    console.error("Lỗi gán học sinh vào lớp:", e);
    throw e;
  }
};

/**
 * Tải chi tiết danh sách học sinh của một lớp học cụ thể (Lazy loading tối ưu băng thông)
 * Chỉ nạp học sinh của lớp đang được xem, không tải toàn bộ học sinh hệ thống.
 */
export const getStudentsByClass = async (
  classId: string, 
  className?: string, 
  academicYear?: string
): Promise<User[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getStudentsByClass(classId, className, academicYear);
  }

  if (!db) {
    try {
      const local = localStorage.getItem(`eduquiz_class_students_${classId}`);
      if (local) return JSON.parse(local);
    } catch {}
    return [];
  }

  try {
    const qRef = collection(db, 'users');
    const q1 = query(qRef, where('classId', '==', classId));
    const snap1 = await getDocs(q1);
    trackFirestoreRead('users', snap1.docs.length);

    const studentsMap = new Map<string, User>();
    snap1.docs.forEach(d => {
      const row = d.data();
      const parsed = (row.data as User) || ({ ...row, id: d.id } as User);
      if (parsed.role === 'student' || !parsed.role) {
        studentsMap.set(d.id, { ...parsed, id: d.id });
      }
    });

    // Fallback đối soát tên lớp + niên khóa đối với dữ liệu cũ chưa có classId
    if (className && academicYear) {
      const q2 = query(qRef, where('className', '==', className), where('academicYear', '==', academicYear));
      const snap2 = await getDocs(q2);
      trackFirestoreRead('users', snap2.docs.length);
      snap2.docs.forEach(d => {
        const row = d.data();
        const parsed = (row.data as User) || ({ ...row, id: d.id } as User);
        if ((parsed.role === 'student' || !parsed.role) && !studentsMap.has(d.id)) {
          studentsMap.set(d.id, { ...parsed, id: d.id });
        }
      });
    }

    const result = Array.from(studentsMap.values());
    result.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

    try {
      localStorage.setItem(`eduquiz_class_students_${classId}`, JSON.stringify(result));
    } catch {}

    return result;
  } catch (e) {
    console.error("Lỗi getStudentsByClass:", e);
    return [];
  }
};

/**
 * Tải danh sách học sinh chưa phân lớp (để phục vụ gán vào lớp mới)
 */
export const getUnassignedStudents = async (): Promise<User[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getUnassignedStudents();
  }
  if (!db) return [];
  try {
    const qRef = collection(db, 'users');
    const q1 = query(qRef, where('classId', '==', ''));
    const snap1 = await getDocs(q1);
    trackFirestoreRead('users', snap1.docs.length);
    const list: User[] = [];
    snap1.docs.forEach(d => {
      const row = d.data();
      const parsed = (row.data as User) || ({ ...row, id: d.id } as User);
      if ((parsed.role === 'student' || !parsed.role) && (!parsed.className || !parsed.className.trim())) {
        list.push({ ...parsed, id: d.id });
      }
    });
    return list;
  } catch (e) {
    console.error("Lỗi getUnassignedStudents:", e);
    return [];
  }
};

// --- Question Bank & Smart Deduplication ---

/**
 * Tạo chữ ký định danh duy nhất (Fingerprint) của câu hỏi dựa trên nội dung, dạng câu, đáp án, môn học & khối lớp.
 * Giúp phát hiện và ngăn chặn câu hỏi trùng lặp 100%.
 */
export const getQuestionFingerprint = (q: Partial<Question>): string => {
  if (!q) return '';
  // Chuẩn hóa văn bản: xóa khoảng trắng thừa, chuyển chữ thường, bỏ dấu nhãn đầu câu
  let normText = (q.text || '')
    .trim()
    .toLowerCase()
    .replace(/^(\*?[a-z0-9][\.\)\/\-:\s]\s*)/gi, '')
    .replace(/\s+/g, ' ');

  const type = (q.type || 'mcq').toLowerCase().replace('_', '-');
  const normSubject = (q.subject || '').trim().toLowerCase();
  const normGrade = (q.quizGrade || '').toString().trim().toLowerCase();

  let optionsSig = '';
  if (type === 'mcq' && q.options && q.options.length > 0) {
    optionsSig = q.options
      .map(opt => (opt || '').trim().toLowerCase().replace(/^(\*?[a-z0-9][\.\)\/\-:\s]\s*)/gi, '').replace(/\s+/g, ' '))
      .sort()
      .join('###');
  } else if (type === 'group-tf' && q.subQuestions && q.subQuestions.length > 0) {
    optionsSig = q.subQuestions
      .map(sq => (sq.text || '').trim().toLowerCase().replace(/^(\*?[a-z0-9][\.\)\/\-:\s]\s*)/gi, '').replace(/\s+/g, ' ') + `:${sq.correctAnswer}`)
      .join('###');
  } else if (type === 'short') {
    optionsSig = (q.correctAnswer || '').trim().toLowerCase();
  }

  return `${normSubject}__${normGrade}__${type}__${normText}__${optionsSig}`;
};

export const getBankQuestions = async (
  forceRefresh: boolean = false,
  filters?: { subject?: string; grade?: string; limit?: number }
): Promise<Question[]> => {
  const isFiltered = !!(filters && ((filters.subject && filters.subject !== 'all') || (filters.grade && filters.grade !== 'all')));
  const filterKey = isFiltered ? `${filters?.subject || 'all'}__${filters?.grade || 'all'}` : 'all';
  const now = Date.now();

  if (!forceRefresh) {
    if (isFiltered && memoryCache.bankByFilter?.has(filterKey)) {
      const cached = memoryCache.bankByFilter.get(filterKey);
      if (cached && cached.expires > now) {
        return cached.data;
      }
    } else if (!isFiltered && memoryCache.bankQuestions && memoryCache.bankQuestions.expires > now) {
      return memoryCache.bankQuestions.data;
    }
  }

  if (isSupabasePrimary()) {
    const questions = await supabaseDb.getBankQuestions(filters);
    if (isFiltered) {
      if (!memoryCache.bankByFilter) memoryCache.bankByFilter = new Map();
      memoryCache.bankByFilter.set(filterKey, { data: questions, expires: now + 5 * 60 * 1000 });
    } else {
      memoryCache.bankQuestions = { data: questions, expires: now + 5 * 60 * 1000 };
    }
    return questions;
  }

  if (!db) {
    try {
      const local = localStorage.getItem('eduquiz_bank_questions_cache');
      if (local) {
        return JSON.parse(local);
      }
    } catch {}
    return [];
  }

  try {
    const snapshot = await getDocs(collection(db, 'bank_questions'));
    trackFirestoreRead('bank_questions', snapshot.docs.length);
    let questions = snapshot.docs.map(d => {
      const row = d.data();
      return (row.data as Question) || (row as Question);
    });

    if (filters?.grade && filters.grade !== 'all') {
      questions = questions.filter(q => String(q.quizGrade || '') === String(filters.grade));
    }
    if (filters?.subject && filters.subject !== 'all') {
      questions = questions.filter(q => q.subject && isSameSubject(q.subject, filters.subject!));
    }

    if (isFiltered) {
      if (!memoryCache.bankByFilter) memoryCache.bankByFilter = new Map();
      memoryCache.bankByFilter.set(filterKey, { data: questions, expires: now + 5 * 60 * 1000 });
    } else {
      memoryCache.bankQuestions = { data: questions, expires: now + 5 * 60 * 1000 };
      try {
        localStorage.setItem('eduquiz_bank_questions_cache', JSON.stringify(questions));
      } catch {}
    }

    return questions;
  } catch (e) {
    console.error("Lỗi lấy ngân hàng câu hỏi:", e);
    try {
      const local = localStorage.getItem('eduquiz_bank_questions_cache');
      if (local) return JSON.parse(local);
    } catch {}
    return memoryCache.bankQuestions?.data || [];
  }
};

export interface SyncBankResult {
  totalScanned: number;
  added: number;
  updated: number;
  skippedDuplicates: number;
}

/**
 * Đồng bộ câu hỏi từ các đề thi vào Ngân hàng câu hỏi (có cơ chế Chống trùng lặp thông minh)
 */
export const syncQuizzesToBank = async (targetSubject?: string): Promise<SyncBankResult> => {
  try {
    const isFiltered = targetSubject && targetSubject !== 'all';
    
    // 1. Tải toàn bộ câu hỏi hiện có trong Ngân hàng (từ Supabase hoặc Firestore)
    let existingBankList: Question[] = [];
    if (isSupabasePrimary()) {
      existingBankList = await supabaseDb.getBankQuestions(isFiltered ? { subject: targetSubject } : undefined);
    } else if (db) {
      const existingBankSnap = await getDocs(collection(db, 'bank_questions'));
      trackFirestoreRead('bank_questions', existingBankSnap.docs.length);
      existingBankList = existingBankSnap.docs.map(d => {
        const row = d.data();
        const bq = (row.data as Question) || (row as Question);
        return { ...bq, id: d.id || bq.id };
      });
    }

    const existingBankMapById = new Map<string, Question>();
    const existingBankMapByFingerprint = new Map<string, string>(); // fingerprint -> docId

    existingBankList.forEach(bq => {
      const bqId = bq.id;
      existingBankMapById.set(bqId, bq);
      const fp = getQuestionFingerprint(bq);
      if (fp) {
        existingBankMapByFingerprint.set(fp, bqId);
      }
    });

    // 2. Quét toàn bộ đề thi
    let allQuizzes: Quiz[] = [];
    if (isSupabasePrimary()) {
      allQuizzes = await supabaseDb.getQuizzes();
    } else if (db) {
      const quizSnap = await getDocs(collection(db, 'quizzes'));
      trackFirestoreRead('quizzes', quizSnap.docs.length);
      allQuizzes = quizSnap.docs.map(d => {
        const row = d.data();
        const qz = (row.data as Quiz) || (row as Quiz);
        return { ...qz, id: d.id || qz.id };
      });
    }

    let totalScanned = 0;
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    const questionsToUpsertMap = new Map<string, { docId: string; question: Question; isNew: boolean }>();

    allQuizzes.forEach(quiz => {
      if (quiz.questions && Array.isArray(quiz.questions)) {
        quiz.questions.forEach(q => {
          const qSubject = q.subject || quiz.subject || '';
          if (isFiltered && !isSameSubject(qSubject, targetSubject)) {
            return; // Bỏ qua câu hỏi thuộc môn khác
          }

          totalScanned++;
          const enrichedQ: Question = {
            ...q,
            quizTitle: quiz.title,
            quizGrade: quiz.grade,
            quizCategory: q.quizCategory || q.chapterName || quiz.category || '',
            chapterId: q.chapterId || undefined,
            chapterName: q.chapterName || q.quizCategory || quiz.category || undefined,
            subject: qSubject,
            createdBy: q.createdBy || quiz.createdBy || '',
            createdByName: q.createdByName || quiz.createdByName || ''
          };

          const fp = getQuestionFingerprint(enrichedQ);

          // Kiểm tra theo ID gốc từ ngân hàng hoặc theo Fingerprint
          let targetDocId: string | null = null;
          if (q.bankQuestionId && existingBankMapById.has(q.bankQuestionId)) {
            targetDocId = q.bankQuestionId;
          } else if (fp && existingBankMapByFingerprint.has(fp)) {
            targetDocId = existingBankMapByFingerprint.get(fp)!;
          }

          if (targetDocId) {
            // Câu hỏi đã có trong ngân hàng -> Cập nhật thông tin nếu có thêm ảnh / lời giải / mức độ
            const currentBq = existingBankMapById.get(targetDocId);
            const mergedQ: Question = {
              ...(currentBq || enrichedQ),
              ...enrichedQ,
              id: targetDocId,
              imageUrl: enrichedQ.imageUrl || currentBq?.imageUrl,
              solution: enrichedQ.solution || currentBq?.solution,
              level: enrichedQ.level || currentBq?.level,
            };
            existingBankMapById.set(targetDocId, mergedQ);
            questionsToUpsertMap.set(targetDocId, { docId: targetDocId, question: mergedQ, isNew: false });
            updatedCount++;
            skippedCount++; // Tránh tạo trùng lặp
          } else {
            // Câu hỏi mới hoàn toàn
            const newDocId = q.bankQuestionId || q.id || uuidv4();
            enrichedQ.id = newDocId;
            questionsToUpsertMap.set(newDocId, { docId: newDocId, question: enrichedQ, isNew: true });
            existingBankMapById.set(newDocId, enrichedQ);
            if (fp) existingBankMapByFingerprint.set(fp, newDocId);
            addedCount++;
          }
        });
      }
    });

    const questionsToUpsert = Array.from(questionsToUpsertMap.values());

    if (questionsToUpsert.length === 0) {
      return { totalScanned, added: 0, updated: 0, skippedDuplicates: skippedCount };
    }

    // 3. Thực thi lưu
    if (isSupabasePrimary()) {
      const qList = questionsToUpsert.map(item => item.question);
      await supabaseDb.saveBatchBankQuestions(qList);
      if (isDualSyncActive()) {
        const chunkSize = 350;
        for (let i = 0; i < questionsToUpsert.length; i += chunkSize) {
          const chunk = questionsToUpsert.slice(i, i + chunkSize);
          const batch = writeBatch(db!);
          for (const item of chunk) {
            batch.set(doc(db!, 'bank_questions', item.docId), cleanUndefined({
              id: item.docId,
              subject: item.question.subject || '',
              grade: item.question.quizGrade || '',
              createdBy: item.question.createdBy || '',
              data: cleanUndefined(item.question)
            }), { merge: true });
          }
          await batch.commit().catch(() => {});
        }
      }
    } else if (db) {
      const chunkSize = 350;
      for (let i = 0; i < questionsToUpsert.length; i += chunkSize) {
        const chunk = questionsToUpsert.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, 'bank_questions', item.docId), cleanUndefined({
            id: item.docId,
            subject: item.question.subject || '',
            grade: item.question.quizGrade || '',
            createdBy: item.question.createdBy || '',
            data: cleanUndefined(item.question)
          }), { merge: true });
        }
        await batch.commit();
        trackFirestoreWrite('bank_questions', chunk.length);
      }
    }

    invalidateMemoryCache('bank');

    return {
      totalScanned,
      added: addedCount,
      updated: updatedCount,
      skippedDuplicates: totalScanned - addedCount
    };
  } catch (e) {
    console.error("Lỗi đồng bộ về Ngân hàng:", e);
    throw e;
  }
};

export interface DeduplicateBankResult {
  totalScanned: number;
  duplicatesRemoved: number;
  uniqueRemaining: number;
}

/**
 * Quét toàn bộ Ngân hàng câu hỏi (hoặc lọc theo môn), phát hiện các câu hỏi trùng lặp nội dung và tự động gộp/xóa bản thừa
 */
export const deduplicateBankQuestions = async (targetSubject?: string): Promise<DeduplicateBankResult> => {
  try {
    const isFiltered = targetSubject && targetSubject !== 'all';
    let allBankQuestions: Question[] = [];

    if (isSupabasePrimary()) {
      allBankQuestions = await supabaseDb.getBankQuestions(isFiltered ? { subject: targetSubject } : undefined);
    } else if (db) {
      const snapshot = await getDocs(collection(db, 'bank_questions'));
      trackFirestoreRead('bank_questions', snapshot.docs.length);
      allBankQuestions = snapshot.docs.map(d => {
        const row = d.data();
        const q = (row.data as Question) || (row as Question);
        return { ...q, id: d.id };
      });
    }

    if (isFiltered) {
      allBankQuestions = allBankQuestions.filter(q => isSameSubject(q.subject || '', targetSubject));
    }

    const totalScanned = allBankQuestions.length;
    if (totalScanned <= 1) {
      return { totalScanned, duplicatesRemoved: 0, uniqueRemaining: totalScanned };
    }

    // Nhóm theo Fingerprint
    const groups = new Map<string, Question[]>();
    for (const q of allBankQuestions) {
      const fp = getQuestionFingerprint(q);
      if (!groups.has(fp)) {
        groups.set(fp, []);
      }
      groups.get(fp)!.push(q);
    }

    const idsToDelete: string[] = [];
    const questionsToKeepAndMerge: Question[] = [];

    groups.forEach((items) => {
      if (items.length === 1) {
        questionsToKeepAndMerge.push(items[0]);
      } else {
        // Có từ 2 câu trở lên trùng lặp nội dung
        // Chọn câu tốt nhất làm câu chính (có ảnh, có lời giải, có phân loại mức độ)
        const primary = items.reduce((best, cur) => {
          let scoreBest = 0;
          let scoreCur = 0;
          if (best.imageUrl) scoreBest += 3;
          if (best.solution) scoreBest += 2;
          if (best.level) scoreBest += 1;
          if (best.createdByName) scoreBest += 1;

          if (cur.imageUrl) scoreCur += 3;
          if (cur.solution) scoreCur += 2;
          if (cur.level) scoreCur += 1;
          if (cur.createdByName) scoreCur += 1;

          return scoreCur > scoreBest ? cur : best;
        }, items[0]);

        // Gộp những thông tin còn thiếu từ các bản sao vào bản chính
        const merged: Question = { ...primary };
        for (const item of items) {
          if (!merged.imageUrl && item.imageUrl) merged.imageUrl = item.imageUrl;
          if (!merged.solution && item.solution) merged.solution = item.solution;
          if (!merged.level && item.level) merged.level = item.level;
          if (!merged.subject && item.subject) merged.subject = item.subject;
        }

        questionsToKeepAndMerge.push(merged);

        // Các bản sao còn lại đánh dấu để xóa
        items.forEach(item => {
          if (item.id !== primary.id) {
            idsToDelete.push(item.id);
          }
        });
      }
    });

    // Thực thi xóa các bản sao trùng lặp
    if (idsToDelete.length > 0) {
      if (isSupabasePrimary()) {
        await supabaseDb.deleteBatchBankQuestions(idsToDelete);
        if (isDualSyncActive()) {
          deleteBatchBankQuestionsFromFirestore(idsToDelete).catch(() => {});
        }
      } else if (db) {
        const chunkSize = 350;
        for (let i = 0; i < idsToDelete.length; i += chunkSize) {
          const chunk = idsToDelete.slice(i, i + chunkSize);
          const batch = writeBatch(db);
          for (const id of chunk) {
            batch.delete(doc(db, 'bank_questions', id));
          }
          await batch.commit();
          trackFirestoreDelete('bank_questions', chunk.length);
        }
      }
    }

    // Cập nhật lại các câu hỏi đã gộp (nếu cần cập nhật nội dung tốt hơn)
    if (isSupabasePrimary()) {
      await supabaseDb.saveBatchBankQuestions(questionsToKeepAndMerge);
    }

    invalidateMemoryCache('bank');

    return {
      totalScanned,
      duplicatesRemoved: idsToDelete.length,
      uniqueRemaining: questionsToKeepAndMerge.length
    };
  } catch (e) {
    console.error("Lỗi khi dọn dẹp câu hỏi trùng lặp:", e);
    throw e;
  }
};

export const saveBankQuestionToFirestore = async (q: Question): Promise<void> => {
  if (db) {
    await setDoc(doc(db, 'bank_questions', q.id), cleanUndefined({
      id: q.id,
      subject: q.subject || '',
      grade: q.quizGrade || '',
      createdBy: q.createdBy || '',
      data: cleanUndefined(q)
    }));
    invalidateMemoryCache('bank');
    trackFirestoreWrite('bank_questions', 1);
  }
};

export const saveBankQuestion = async (q: Question): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveBankQuestion(q);
    if (isDualSyncActive()) {
      saveBankQuestionToFirestore(q).catch((err) => {
        console.warn("Dual sync bank question to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveBankQuestionToFirestore(q);
};

export const deleteBankQuestionFromFirestore = async (id: string): Promise<void> => {
  if (!id) return;
  if (db) {
    await deleteDoc(doc(db, 'bank_questions', id));
    invalidateMemoryCache('bank');
    trackFirestoreDelete('bank_questions', 1);
  }
};

export const deleteBankQuestion = async (id: string): Promise<void> => {
  if (!id) return;
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteBankQuestion(id);
    if (isDualSyncActive()) {
      deleteBankQuestionFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deleteBankQuestionFromFirestore(id);
};

export const deleteBatchBankQuestionsFromFirestore = async (ids: string[]): Promise<number> => {
  if (!ids || ids.length === 0 || !db) return 0;
  const chunkSize = 400;
  let deletedCount = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const id of chunk) {
      batch.delete(doc(db, 'bank_questions', id));
    }
    await batch.commit();
    deletedCount += chunk.length;
    trackFirestoreDelete('bank_questions', chunk.length);
  }
  invalidateMemoryCache('bank');
  return deletedCount;
};

export const deleteBatchBankQuestions = async (ids: string[]): Promise<number> => {
  if (!ids || ids.length === 0) return 0;
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteBatchBankQuestions(ids);
    if (isDualSyncActive()) {
      deleteBatchBankQuestionsFromFirestore(ids).catch(() => {});
    }
    return res;
  }
  return await deleteBatchBankQuestionsFromFirestore(ids);
};

// Upload Quiz Image (supports Firebase Storage with generous timeout, or compressed Base64 fallback)
export type ImageStorageDestination = 'cloud' | 'base64' | 'auto';

// Lấy ImgBB API Key từ localStorage
export const getImgBBKey = (): string => {
  try {
    return localStorage.getItem('eduquiz_imgbb_api_key') || '';
  } catch {
    return '';
  }
};

export const setImgBBKey = (key: string): void => {
  try {
    if (key && key.trim()) {
      localStorage.setItem('eduquiz_imgbb_api_key', key.trim());
    } else {
      localStorage.removeItem('eduquiz_imgbb_api_key');
    }
  } catch (e) {
    console.error("Lỗi lưu ImgBB Key:", e);
  }
};

// Tải ảnh trực tiếp lên ImgBB (miễn phí, không phụ thuộc Firebase Console)
export const uploadBlobToImgBB = async (blob: Blob, apiKey?: string): Promise<string> => {
  const key = apiKey || getImgBBKey();
  if (!key) throw new Error("Chưa cấu hình ImgBB API Key");

  const formData = new FormData();
  formData.append('image', blob);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
    method: 'POST',
    body: formData
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message || `Lỗi tải ảnh lên ImgBB (Mã: ${json.status_code || res.status})`);
  }

  return json.data.url;
};

// Định dạng lỗi Firebase Storage thành thông báo tiếng Việt dễ hiểu
export const formatStorageError = (err: any): { 
  type: 'not-found' | 'unauthorized' | 'unknown'; 
  status: number; 
  code: string; 
  message: string; 
} => {
  const code = err?.code || '';
  const status = err?.status_ || err?.customData?.serverResponse?.status || 0;
  const rawMsg = err?.message || '';

  if (status === 404 || code === 'storage/bucket-not-found' || (code === 'storage/unknown' && (rawMsg.includes('404') || status === 404))) {
    return {
      type: 'not-found',
      status: 404,
      code,
      message: 'Lỗi 404: Storage Bucket chưa được kích hoạt trên Firebase Console. Bạn cần vào Firebase Console mục Storage bấm "Get started" (Bắt đầu).'
    };
  }

  if (status === 403 || code === 'storage/unauthorized') {
    return {
      type: 'unauthorized',
      status: 403,
      code,
      message: 'Lỗi 403 (Permission Denied): Chưa có quyền ghi vào Storage. Bạn cần mở tab Rules trong Firebase Storage và đổi thành "allow read, write: if true;".'
    };
  }

  return {
    type: 'unknown',
    status,
    code,
    message: rawMsg || 'Lỗi kết nối Firebase Storage không xác định.'
  };
};

// Lấy instance Storage tương ứng (hỗ trợ custom bucket hoặc fallback sang .appspot.com)
export const getResolvedFirebaseStorage = (overrideBucket?: string) => {
  try {
    const custom = overrideBucket || localStorage.getItem('eduquiz_custom_storage_bucket') || '';
    if (custom) {
      const bucketUrl = custom.startsWith('gs://') ? custom : `gs://${custom}`;
      return getStorage(app, bucketUrl);
    }
  } catch (e) {
    console.warn("Lỗi đọc custom bucket:", e);
  }
  return storage;
};

// Hàm kiểm tra kết nối tới Firebase Storage trực tiếp
export const testStorageConnection = async (customBucket?: string): Promise<{
  success: boolean;
  status: 'active' | 'not_found' | 'unauthorized' | 'error';
  message: string;
  bucket: string;
  url?: string;
}> => {
  const targetBucket = customBucket || localStorage.getItem('eduquiz_custom_storage_bucket') || firebaseConfig.storageBucket || `${firebaseConfig.projectId}.firebasestorage.app`;
  const currentStorage = getStorage(app, targetBucket.startsWith('gs://') ? targetBucket : `gs://${targetBucket}`);

  const testFileRef = ref(currentStorage, `_healthcheck/${Date.now()}.txt`);
  const blob = new Blob(["healthcheck"], { type: "text/plain" });

  try {
    const snap = await uploadBytes(testFileRef, blob);
    const downloadUrl = await getDownloadURL(snap.ref);
    // Dọn dẹp file test
    try {
      await deleteObject(snap.ref);
    } catch {
      // bỏ qua lỗi xóa
    }
    return {
      success: true,
      status: 'active',
      bucket: targetBucket,
      message: 'Kết nối Firebase Storage thành công! Đã sẵn sàng lưu ảnh trực tuyến.',
      url: downloadUrl
    };
  } catch (err: any) {
    const errInfo = formatStorageError(err);
    let status: 'active' | 'not_found' | 'unauthorized' | 'error' = 'error';
    if (errInfo.type === 'not-found') status = 'not_found';
    else if (errInfo.type === 'unauthorized') status = 'unauthorized';

    return {
      success: false,
      status,
      bucket: targetBucket,
      message: errInfo.message
    };
  }
};

export const uploadQuizImage = async (
  file: File | Blob, 
  mode: ImageStorageDestination = 'cloud'
): Promise<string> => {
  try {
    // 1. Nén ảnh client-side trước để siêu nhẹ & tải tức thì
    const { dataUrl, blob } = await compressImageFile(file, 900, 900, 0.82);

    // Nếu người dùng chủ động chọn lưu Base64 cục bộ
    if (mode === 'base64') {
      return dataUrl;
    }

    // 2. Kiểm tra nếu có cấu hình ImgBB API Key -> Tải lên ImgBB trước
    const imgbbKey = getImgBBKey();
    if (imgbbKey) {
      try {
        const imgbbUrl = await uploadBlobToImgBB(blob, imgbbKey);
        if (imgbbUrl) return imgbbUrl;
      } catch (imgbbErr) {
        console.warn("Tải lên ImgBB thất bại, thử tiếp Firebase Storage:", imgbbErr);
      }
    }

    // 3. Tải lên Firebase Cloud Storage
    const activeStorage = getResolvedFirebaseStorage();
    if (activeStorage) {
      const fileExt = (file instanceof File && file.type === 'image/png') ? 'png' : 'jpg';
      const fileName = `quiz-images/${uuidv4()}.${fileExt}`;
      const metadata = {
        contentType: fileExt === 'png' ? 'image/png' : 'image/jpeg',
        customMetadata: { uploadedAt: new Date().toISOString() }
      };

      try {
        const imageRef = ref(activeStorage, fileName);
        const storageUploadPromise = (async () => {
          const snapshot = await uploadBytes(imageRef, blob, metadata);
          return await getDownloadURL(snapshot.ref);
        })();

        const timeoutPromise = new Promise<string>((_, reject) => 
          setTimeout(() => reject(new Error("Quá thời gian tải lên Firebase Storage (15s)")), 15000)
        );

        const cloudUrl = await Promise.race([storageUploadPromise, timeoutPromise]);
        if (cloudUrl) return cloudUrl;
      } catch (err: any) {
        const errInfo = formatStorageError(err);
        console.warn("Lần 1 tải lên Storage thất bại:", errInfo.message);

        // Nếu lỗi 404 trên bucket chính và chưa cấu hình custom bucket, thử tiếp bucket đuôi .appspot.com
        if (errInfo.type === 'not-found' && !localStorage.getItem('eduquiz_custom_storage_bucket')) {
          const fallbackBucket = `${firebaseConfig.projectId}.appspot.com`;
          try {
            const altStorage = getStorage(app, `gs://${fallbackBucket}`);
            const altRef = ref(altStorage, fileName);
            const altSnapshot = await uploadBytes(altRef, blob, metadata);
            const altUrl = await getDownloadURL(altSnapshot.ref);
            // Ghi nhớ bucket hoạt động để các lần sau không cần thử lại
            localStorage.setItem('eduquiz_custom_storage_bucket', fallbackBucket);
            return altUrl;
          } catch (altErr) {
            console.warn("Fallback bucket cũng không khả dụng:", altErr);
          }
        }

        // Lưu thông tin lỗi vào sessionStorage và phát event để UI hiển thị thông báo chính xác
        try {
          sessionStorage.setItem('eduquiz_last_storage_error', JSON.stringify({
            message: errInfo.message,
            type: errInfo.type,
            time: Date.now()
          }));
          window.dispatchEvent(new CustomEvent('eduquiz_storage_upload_failed', { 
            detail: { error: errInfo.message, type: errInfo.type } 
          }));
        } catch {
          // ignore
        }

        // Thử tiếp Supabase Storage nếu có cấu hình trước khi nén base64
        try {
          const supabaseUrl = await uploadImageToSupabaseStorage(blob, fileExt);
          if (supabaseUrl) return supabaseUrl;
        } catch (sbErr) {
          console.warn("Supabase storage upload fallback failed:", sbErr);
        }

        // Tự động fallback sang Base64 nén để không làm gián đoạn công việc của giáo viên
        return dataUrl;
      }
    }

    // 4. Thử Supabase Storage nếu Firebase Storage chưa được kết nối
    try {
      const fileExt = (file instanceof File && file.type === 'image/png') ? 'png' : 'jpg';
      const supabaseUrl = await uploadImageToSupabaseStorage(blob, fileExt);
      if (supabaseUrl) return supabaseUrl;
    } catch {
      // ignore
    }

    // 5. Trả về Base64 nén nếu chưa cấu hình storage nào
    return dataUrl;
  } catch (error) {
    console.error("Lỗi xử lý ảnh:", error);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }
};

// Tải một chuỗi ảnh Base64 sẵn có lên Firebase Storage hoặc ImgBB và lấy đường dẫn URL
export const uploadBase64ToStorage = async (dataUrl: string): Promise<string> => {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;

  const res = await fetch(dataUrl);
  const blob = await res.blob();

  // 1. Kiểm tra nếu có cấu hình ImgBB API Key
  const imgbbKey = getImgBBKey();
  if (imgbbKey) {
    return await uploadBlobToImgBB(blob, imgbbKey);
  }

  // 1.5. Kiểm tra nếu có cấu hình Supabase Storage
  try {
    const supabaseUrl = await uploadImageToSupabaseStorage(blob, 'jpg');
    if (supabaseUrl) return supabaseUrl;
  } catch {
    // Thử tiếp các phương thức khác
  }

  // 2. Tải lên Firebase Cloud Storage
  const activeStorage = getResolvedFirebaseStorage();
  if (!activeStorage) throw new Error("Firebase Storage chưa được khởi tạo!");

  const fileName = `quiz-images/${uuidv4()}.jpg`;
  const metadata = {
    contentType: 'image/jpeg',
    customMetadata: { convertedFromBase64: 'true', uploadedAt: new Date().toISOString() }
  };

  try {
    const imageRef = ref(activeStorage, fileName);
    const snapshot = await uploadBytes(imageRef, blob, metadata);
    return await getDownloadURL(snapshot.ref);
  } catch (err: any) {
    const errInfo = formatStorageError(err);
    
    // Nếu lỗi 404 và chưa cấu hình custom bucket, thử bucket đuôi .appspot.com
    if (errInfo.type === 'not-found' && !localStorage.getItem('eduquiz_custom_storage_bucket')) {
      const fallbackBucket = `${firebaseConfig.projectId}.appspot.com`;
      try {
        const altStorage = getStorage(app, `gs://${fallbackBucket}`);
        const altRef = ref(altStorage, fileName);
        const altSnapshot = await uploadBytes(altRef, blob, metadata);
        const altUrl = await getDownloadURL(altSnapshot.ref);
        localStorage.setItem('eduquiz_custom_storage_bucket', fallbackBucket);
        return altUrl;
      } catch {
        // Fallback cũng không được
      }
    }

    throw new Error(errInfo.message);
  }
};

// Quét toàn bộ đề thi và chuyển các ảnh dạng Base64 lên Cloud Storage hàng loạt
export const batchUploadQuizImagesToStorage = async (
  questions: Question[],
  onProgress?: (current: number, total: number) => void
): Promise<{ updatedQuestions: Question[]; successCount: number; failCount: number; lastError?: string }> => {
  let successCount = 0;
  let failCount = 0;
  let lastError = '';

  const base64Questions = questions.filter(q => q.imageUrl && q.imageUrl.startsWith('data:image/'));
  const total = base64Questions.length;
  let processed = 0;

  const urlMap = new Map<string, string>();
  const updatedQuestions: Question[] = [];

  for (const q of questions) {
    if (!q.imageUrl || !q.imageUrl.startsWith('data:image/')) {
      updatedQuestions.push(q);
      continue;
    }

    try {
      let cloudUrl: string;
      if (urlMap.has(q.imageUrl)) {
        cloudUrl = urlMap.get(q.imageUrl)!;
      } else {
        cloudUrl = await uploadBase64ToStorage(q.imageUrl);
        urlMap.set(q.imageUrl, cloudUrl);
      }
      updatedQuestions.push({ ...q, imageUrl: cloudUrl });
      successCount++;
    } catch (err: any) {
      lastError = err?.message || 'Lỗi không xác định';
      console.error(`Không thể chuyển ảnh câu ${q.id} lên Storage:`, err);
      updatedQuestions.push(q);
      failCount++;
    }

    processed++;
    if (onProgress) onProgress(processed, total);
  }

  return { updatedQuestions, successCount, failCount, lastError };
};

// --- Published Results ---
export const getPublishedResults = async (limitCount: number = 20): Promise<PublishedResult[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getPublishedResults(limitCount);
  }
  if (!db) return [];
  try {
    const q = query(collection(db, 'published_results'), limit(limitCount));
    const snapshot = await getDocs(q);
    trackFirestoreRead('published_results', snapshot.docs.length);
    const list = snapshot.docs.map(d => {
      const row = d.data();
      return (row.data as PublishedResult) || (row as PublishedResult);
    });
    list.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
    return list;
  } catch (e) {
    return [];
  }
};

export const savePublishedResultToFirestore = async (pub: PublishedResult): Promise<void> => {
  if (db) {
    await setDoc(doc(db, 'published_results', pub.id), cleanUndefined({
      id: pub.id,
      quizId: pub.quizId,
      quizTitle: pub.quizTitle,
      publishedAt: pub.publishedAt,
      data: cleanUndefined(pub)
    }));
    trackFirestoreWrite('published_results', 1);
  }
};

export const savePublishedResult = async (pub: PublishedResult): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.savePublishedResult(pub);
    if (isDualSyncActive()) {
      savePublishedResultToFirestore(pub).catch((err) => {
        console.warn("Dual sync published result to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await savePublishedResultToFirestore(pub);
};

export const deletePublishedResultFromFirestore = async (id: string): Promise<void> => {
  if (db) {
    await deleteDoc(doc(db, 'published_results', id));
    trackFirestoreDelete('published_results', 1);
  }
};

export const deletePublishedResult = async (id: string): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deletePublishedResult(id);
    if (isDualSyncActive()) {
      deletePublishedResultFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deletePublishedResultFromFirestore(id);
};

// --- Exam Sessions ---
export const saveExamSessionToFirestore = async (session: ExamSession): Promise<void> => {
  if (db) {
    await setDoc(doc(db, 'exam_sessions', session.id), cleanUndefined({
      id: session.id,
      quizId: session.quizId,
      studentId: session.studentId,
      data: cleanUndefined(session)
    }));
    trackFirestoreWrite('exam_sessions', 1);
  }
};

export const saveExamSession = async (session: ExamSession): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.saveExamSession(session);
    if (isDualSyncActive()) {
      saveExamSessionToFirestore(session).catch((err) => {
        console.warn("Dual sync exam session to Firestore skipped/failed (non-fatal):", err);
      });
    }
    return res;
  }
  return await saveExamSessionToFirestore(session);
};

export const deleteExamSessionFromFirestore = async (id: string): Promise<void> => {
  if (db) {
    await deleteDoc(doc(db, 'exam_sessions', id));
    trackFirestoreDelete('exam_sessions', 1);
  }
};

export const deleteExamSession = async (id: string): Promise<void> => {
  if (isSupabasePrimary()) {
    const res = await supabaseDb.deleteExamSession(id);
    if (isDualSyncActive()) {
      deleteExamSessionFromFirestore(id).catch(() => {});
    }
    return res;
  }
  return await deleteExamSessionFromFirestore(id);
};

export const getExamSessions = async (quizId?: string): Promise<ExamSession[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getExamSessions(quizId);
  }
  if (!db) return [];
  try {
    let q = query(collection(db, 'exam_sessions'));
    if (quizId && quizId !== 'all') {
      q = query(collection(db, 'exam_sessions'), where('quizId', '==', quizId));
    }
    const snapshot = await getDocs(q);
    trackFirestoreRead('exam_sessions', snapshot.docs.length);
    return snapshot.docs.map(d => {
      const row = d.data();
      return (row.data as ExamSession) || (row as ExamSession);
    });
  } catch (e) {
    return [];
  }
};

export const getStudentActiveSessions = async (studentId: string): Promise<ExamSession[]> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.getStudentActiveSessions(studentId);
  }
  if (!db) return [];
  try {
    const q = query(collection(db, 'exam_sessions'), where('studentId', '==', studentId));
    const snapshot = await getDocs(q);
    trackFirestoreRead('exam_sessions', snapshot.docs.length);
    return snapshot.docs.map(d => {
      const row = d.data();
      return (row.data as ExamSession) || (row as ExamSession);
    });
  } catch (e) {
    return [];
  }
};

export const clearAllSessions = async (): Promise<void> => {
  if (isSupabasePrimary()) {
    return await supabaseDb.clearAllSessions();
  }
  if (!db) return;
  try {
    const snapshot = await getDocs(collection(db, 'exam_sessions'));
    trackFirestoreRead('exam_sessions', snapshot.docs.length);
    const batch = writeBatch(db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    trackFirestoreDelete('exam_sessions', snapshot.docs.length);
  } catch (e) {
    console.error("Lỗi clearAllSessions:", e);
  }
};

// Default seed superadmin and admin if needed
export const initStorage = async () => {
  if (!db) return;
  try {
    const superAdminUser = await findUser('superadmin');
    if (!superAdminUser) {
      const defaultSuperAdmin: User = {
        id: 'superadmin-root-account',
        username: 'superadmin',
        password: '123',
        role: 'superadmin',
        fullName: 'Tổng Quản Trị Hệ Thống (SuperAdmin)',
        createdAt: new Date().toISOString()
      };
      await saveUser(defaultSuperAdmin);
    } else if (superAdminUser.role !== 'superadmin') {
      await saveUser({ ...superAdminUser, role: 'superadmin' });
    }

    const adminUser = await findUser('admin');
    if (!adminUser) {
      const defaultAdmin: User = {
        id: 'admin-system-account',
        username: 'admin',
        password: '123',
        role: 'superadmin',
        fullName: 'Tổng Quản Trị Hệ Thống (Admin)',
        createdAt: new Date().toISOString()
      };
      await saveUser(defaultAdmin);
    } else if (adminUser.role !== 'superadmin') {
      await saveUser({ ...adminUser, role: 'superadmin', fullName: adminUser.fullName || 'Tổng Quản Trị Hệ Thống (Admin)' });
    }
  } catch (e) {
    console.warn("InitStorage check:", e);
  }
};

export const clearLocalCache = () => {
  localStorage.clear();
  window.location.reload();
};

export interface CollectionStat {
  name: string;
  label: string;
  count: number;
  estimatedSizeBytes: number;
  description: string;
  readsToday: number;
  estimatedReadsPerLoad: number;
}

export interface DatabaseMetrics {
  connected: boolean;
  projectId: string;
  databaseId: string;
  storageBucket: string;
  authDomain: string;
  latencyMs: number;
  status: 'optimal' | 'warning' | 'error' | 'disconnected';
  collections: CollectionStat[];
  totalDocuments: number;
  totalEstimatedSizeBytes: number;
  localCacheSizeBytes: number;
  dailyStats: DailyFirestoreStats;
  quotas: {
    readsDailyLimit: number;
    writesDailyLimit: number;
    deletesDailyLimit: number;
    storageLimitBytes: number;
    bandwidthMonthlyLimitBytes: number;
    estimatedStorageUsedPercent: number;
    readsUsedPercent: number;
  };
  lastChecked: string;
}

export const pingDatabase = async (): Promise<number> => {
  if (!db) return -1;
  const start = performance.now();
  try {
    const q = query(collection(db, 'users'), limit(1));
    await getDocs(q);
    trackFirestoreRead('users', 1);
    const duration = Math.round(performance.now() - start);
    return duration;
  } catch (e) {
    return -1;
  }
};

export const getDatabaseMetrics = async (): Promise<DatabaseMetrics> => {
  if (isSupabasePrimary()) {
    return (await supabaseDb.getDatabaseMetrics()) as any;
  }
  const isConn = isDatabaseConnected();
  const projectId = firebaseConfig?.projectId || 'N/A';
  const databaseId = firebaseConfig?.firestoreDatabaseId || '(default)';
  const storageBucket = firebaseConfig?.storageBucket || 'N/A';
  const authDomain = firebaseConfig?.authDomain || 'N/A';
  const dailyStats = getDailyFirestoreStats();

  // Calculate local storage size
  let localCacheBytes = 0;
  try {
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        localCacheBytes += (localStorage[key].length + key.length) * 2;
      }
    }
  } catch {
    localCacheBytes = 0;
  }

  if (!isConn || !db) {
    return {
      connected: false,
      projectId,
      databaseId,
      storageBucket,
      authDomain,
      latencyMs: -1,
      status: 'disconnected',
      collections: [],
      totalDocuments: 0,
      totalEstimatedSizeBytes: 0,
      localCacheSizeBytes: localCacheBytes,
      dailyStats,
      quotas: {
        readsDailyLimit: 50000,
        writesDailyLimit: 20000,
        deletesDailyLimit: 20000,
        storageLimitBytes: 1073741824, // 1 GiB
        bandwidthMonthlyLimitBytes: 10737418240, // 10 GiB
        estimatedStorageUsedPercent: 0,
        readsUsedPercent: 0
      },
      lastChecked: new Date().toISOString()
    };
  }

  const startPing = performance.now();
  let latencyMs = 0;
  let status: 'optimal' | 'warning' | 'error' = 'optimal';

  // Average size estimation per document (in bytes) based on data model complexity
  const collectionConfigs = [
    { name: 'quizzes', label: 'Đề thi chi tiết', avgBytes: 18000, desc: 'Chứa đề thi, danh sách câu hỏi, hình ảnh và đáp án', perLoad: '1 lần tải chi tiết đề' },
    { name: 'quizzes_metadata', label: 'Chỉ mục đề thi (Metadata)', avgBytes: 600, desc: 'Lưu thông tin tóm tắt đề phục vụ tải trang siêu tốc', perLoad: 'Phân trang (20 đề/trang)' },
    { name: 'users', label: 'Tài khoản người dùng', avgBytes: 800, desc: 'Học sinh, giáo viên, quản trị viên', perLoad: 'Phân trang (50 user/trang)' },
    { name: 'results', label: 'Kết quả & Bài nộp', avgBytes: 4500, desc: 'Chi tiết bài thi của học sinh, đáp án chọn, thời gian làm', perLoad: 'Phân trang (50 bài/trang)' },
    { name: 'classes', label: 'Lớp học', avgBytes: 1200, desc: 'Danh sách lớp và danh sách mã học sinh được gán', perLoad: '1 lần (có Cache)' },
    { name: 'chapters', label: 'Chương mục kiến thức', avgBytes: 400, desc: 'Phân loại bài học theo từng khối và môn', perLoad: '1 lần (có Cache)' },
    { name: 'bank_questions', label: 'Ngân hàng câu hỏi', avgBytes: 2200, desc: 'Kho câu hỏi mẫu phân theo môn học và mức độ', perLoad: '1 lần theo bộ lọc môn' },
    { name: 'exam_sessions', label: 'Phiên giám sát thi', avgBytes: 1000, desc: 'Trạng thái học sinh đang làm bài thi trực tiếp', perLoad: 'Realtime session' },
    { name: 'published_results', label: 'Kết quả công bố', avgBytes: 800, desc: 'Dữ liệu công bố điểm của các đề thi', perLoad: '1 lần theo mã đề' }
  ];

  const collectionsStats: CollectionStat[] = [];
  let totalDocs = 0;
  let totalEstimatedBytes = 0;

  try {
    const counts = await Promise.allSettled(
      collectionConfigs.map(async (c) => {
        try {
          const snapshot = await getCountFromServer(collection(db, c.name));
          return snapshot.data().count;
        } catch {
          // Fallback if collection doesn't exist yet
          return 0;
        }
      })
    );

    latencyMs = Math.round(performance.now() - startPing);
    if (latencyMs > 800) status = 'warning';

    collectionConfigs.forEach((c, idx) => {
      const res = counts[idx];
      const count = res.status === 'fulfilled' ? res.value : 0;
      const estimatedSize = count * c.avgBytes;
      totalDocs += count;
      totalEstimatedBytes += estimatedSize;

      const readsToday = dailyStats.readsByCollection[c.name] || 0;
      const estimatedReadsPerLoad = c.name === 'quizzes_metadata' ? Math.min(20, count || 20)
        : (c.name === 'users' || c.name === 'results') ? Math.min(50, count || 50)
        : count;

      collectionsStats.push({
        name: c.name,
        label: c.label,
        count,
        estimatedSizeBytes: estimatedSize,
        description: c.desc,
        readsToday,
        estimatedReadsPerLoad
      });
    });
  } catch (err) {
    status = 'error';
  }

  const storageLimitBytes = 1073741824; // 1 GiB free tier
  const usedPercent = Math.min(100, Number(((totalEstimatedBytes / storageLimitBytes) * 100).toFixed(2)));
  const readsDailyLimit = 50000;
  const readsUsedPercent = Math.min(100, Number(((dailyStats.totalReads / readsDailyLimit) * 100).toFixed(2)));

  return {
    connected: true,
    projectId,
    databaseId,
    storageBucket,
    authDomain,
    latencyMs,
    status,
    collections: collectionsStats,
    totalDocuments: totalDocs,
    totalEstimatedSizeBytes: totalEstimatedBytes,
    localCacheSizeBytes: localCacheBytes,
    dailyStats,
    quotas: {
      readsDailyLimit,
      writesDailyLimit: 20000,
      deletesDailyLimit: 20000,
      storageLimitBytes,
      bandwidthMonthlyLimitBytes: 10737418240, // 10 GiB
      estimatedStorageUsedPercent: usedPercent,
      readsUsedPercent
    },
    lastChecked: new Date().toISOString()
  };
};

export const exportFullDatabaseBackup = async (): Promise<string> => {
  if (isSupabasePrimary() && isSupabaseConnected()) {
    return await supabaseDb.exportFullDatabaseBackup();
  }
  if (!db) throw new Error("Mất kết nối Database Cloud Firestore");

  const [quizzesSnap, usersSnap, resultsSnap, classesSnap, chaptersSnap, bankSnap, sessionsSnap, publishedSnap] = await Promise.all([
    getDocs(collection(db, 'quizzes')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'results')),
    getDocs(collection(db, 'classes')),
    getDocs(collection(db, 'chapters')),
    getDocs(collection(db, 'bank_questions')),
    getDocs(collection(db, 'exam_sessions')),
    getDocs(collection(db, 'published_results'))
  ]);

  // Thu thập câu hỏi đầy đủ cho từng đề thi (kể cả đề lưu dạng chunks)
  const fullQuizzes: any[] = [];
  for (const docSnap of quizzesSnap.docs) {
    const rawData = docSnap.data();
    let questions: Question[] = [];

    if (Array.isArray(rawData.questions) && rawData.questions.length > 0) {
      questions = rawData.questions;
    } else if (rawData.data && Array.isArray((rawData.data as any).questions)) {
      questions = (rawData.data as any).questions;
    }

    if (questions.length === 0 && (rawData.isChunked || rawData.chunkCount)) {
      try {
        const chunksSnap = await getDocs(collection(db, 'quizzes', docSnap.id, 'chunks'));
        if (!chunksSnap.empty) {
          const sorted = chunksSnap.docs
            .map(d => d.data() as { index: number; questions: Question[] })
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          questions = sorted.flatMap(c => c.questions || []);
        }
      } catch (e) {
        console.warn(`Không thể lấy chunks cho đề thi ${docSnap.id}:`, e);
      }
    }

    const quizObj = (typeof rawData.data === 'object' && rawData.data !== null) ? rawData.data : rawData;
    fullQuizzes.push({
      ...quizObj,
      id: docSnap.id,
      title: rawData.title || quizObj.title || '',
      description: rawData.description || quizObj.description || '',
      type: rawData.type || quizObj.type || 'practice',
      grade: rawData.grade || quizObj.grade || '12',
      category: rawData.category || quizObj.category || '',
      subject: rawData.subject || quizObj.subject || '',
      startTime: rawData.startTime || quizObj.startTime,
      endTime: rawData.endTime || quizObj.endTime,
      durationMinutes: rawData.durationMinutes || quizObj.durationMinutes || 45,
      questions,
      questionCount: questions.length || rawData.questionCount || quizObj.questionCount || 0,
      attemptCount: rawData.attemptCount ?? quizObj.attemptCount ?? 0,
      maxAttempts: rawData.maxAttempts ?? quizObj.maxAttempts ?? 1,
      createdAt: rawData.createdAt || quizObj.createdAt || new Date().toISOString(),
      isPublished: rawData.isPublished ?? quizObj.isPublished ?? false,
      isMonitored: rawData.isMonitored ?? quizObj.isMonitored ?? false,
      showResultAnswers: rawData.showResultAnswers ?? quizObj.showResultAnswers ?? true,
      disablePractice: rawData.disablePractice ?? quizObj.disablePractice ?? false,
      isUnlisted: rawData.isUnlisted ?? quizObj.isUnlisted ?? false,
      orderIndex: rawData.orderIndex ?? quizObj.orderIndex ?? 0,
      createdBy: rawData.createdBy || quizObj.createdBy,
      createdByName: rawData.createdByName || quizObj.createdByName,
      isSharedWithTeachers: rawData.isSharedWithTeachers ?? quizObj.isSharedWithTeachers ?? true,
      academicYear: rawData.academicYear || quizObj.academicYear,
      targetType: rawData.targetType || quizObj.targetType || 'all',
      assignedClassIds: rawData.assignedClassIds || quizObj.assignedClassIds || [],
      assignedClasses: rawData.assignedClasses || quizObj.assignedClasses || []
    });
  }

  const backupData = {
    version: "2.0",
    appName: "EduQuiz VN",
    exportedAt: new Date().toISOString(),
    projectId: firebaseConfig?.projectId,
    databaseId: firebaseConfig?.firestoreDatabaseId,
    stats: {
      quizzes: fullQuizzes.length,
      users: usersSnap.size,
      results: resultsSnap.size,
      classes: classesSnap.size,
      chapters: chaptersSnap.size,
      bankQuestions: bankSnap.size,
      examSessions: sessionsSnap.size,
      publishedResults: publishedSnap.size
    },
    data: {
      quizzes: fullQuizzes,
      users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      results: resultsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      classes: classesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      chapters: chaptersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      bankQuestions: bankSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      examSessions: sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      publishedResults: publishedSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    }
  };

  return JSON.stringify(backupData, null, 2);
};

// Khôi phục toàn bộ CSDL Firestore từ file/chuỗi JSON bản sao lưu
export const restoreFullDatabaseBackup = async (
  backupContent: string | any,
  onProgress?: (step: string, percent: number) => void
): Promise<{ success: boolean; stats: any; message: string }> => {
  if (!db) throw new Error("Mất kết nối Database Cloud Firestore");

  let parsed: any;
  if (typeof backupContent === 'string') {
    try {
      parsed = JSON.parse(backupContent);
    } catch (e: any) {
      throw new Error(`File JSON không hợp lệ: ${e.message}`);
    }
  } else {
    parsed = backupContent;
  }

  const data = parsed.data || parsed;
  const classes: ClassRoom[] = data.classes || [];
  const chapters: Chapter[] = data.chapters || [];
  const users: User[] = data.users || [];
  const bankQuestions: Question[] = data.bankQuestions || data.bank_questions || [];
  const quizzes: Quiz[] = data.quizzes || [];
  const results: Result[] = data.results || [];
  const examSessions: ExamSession[] = data.examSessions || data.exam_sessions || [];
  const publishedResults: PublishedResult[] = data.publishedResults || data.published_results || [];

  const stats = {
    classes: 0,
    chapters: 0,
    users: 0,
    bankQuestions: 0,
    quizzes: 0,
    results: 0,
    examSessions: 0,
    publishedResults: 0
  };

  // Helper thực thi ghi theo batch tối đa 400 bản ghi
  const writeBatchItems = async <T extends { id: string }>(collectionName: string, items: T[]) => {
    if (!items || items.length === 0) return 0;
    const chunkSize = 400;
    let written = 0;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const item of chunk) {
        if (!item.id) continue;
        const ref = doc(db, collectionName, item.id);
        batch.set(ref, cleanUndefined(item), { merge: true });
      }
      await batch.commit();
      trackFirestoreWrite(collectionName, chunk.length);
      written += chunk.length;
    }
    return written;
  };

  try {
    // 1. Khôi phục Lớp học
    if (classes.length > 0) {
      onProgress?.(`Đang khôi phục ${classes.length} lớp học...`, 15);
      stats.classes = await writeBatchItems('classes', classes);
    }

    // 2. Khôi phục Chương bài giảng
    if (chapters.length > 0) {
      onProgress?.(`Đang khôi phục ${chapters.length} chương...`, 30);
      stats.chapters = await writeBatchItems('chapters', chapters);
    }

    // 3. Khôi phục Người dùng (Giáo viên, Học sinh)
    if (users.length > 0) {
      onProgress?.(`Đang khôi phục ${users.length} người dùng...`, 45);
      stats.users = await writeBatchItems('users', users);
    }

    // 4. Khôi phục Ngân hàng câu hỏi
    if (bankQuestions.length > 0) {
      onProgress?.(`Đang khôi phục ${bankQuestions.length} câu hỏi ngân hàng...`, 65);
      stats.bankQuestions = await writeBatchItems('bank_questions', bankQuestions);
    }

    // 5. Khôi phục Đề thi (quizzes)
    if (quizzes.length > 0) {
      onProgress?.(`Đang khôi phục ${quizzes.length} đề thi...`, 80);
      for (const quiz of quizzes) {
        if (!quiz.id) continue;
        await saveQuiz(quiz);
        stats.quizzes++;
      }
    }

    // 6. Khôi phục Kết quả bài thi
    if (results.length > 0) {
      onProgress?.(`Đang khôi phục ${results.length} kết quả làm bài...`, 90);
      stats.results = await writeBatchItems('results', results);
    }

    // 7. Khôi phục phiên thi & kết quả công bố
    if (examSessions.length > 0) {
      stats.examSessions = await writeBatchItems('exam_sessions', examSessions);
    }
    if (publishedResults.length > 0) {
      stats.publishedResults = await writeBatchItems('published_results', publishedResults);
    }

    // Xóa bộ nhớ cache cục bộ để UI tải dữ liệu mới nhất
    clearLocalCache();
    onProgress?.("Khôi phục hoàn tất!", 100);

    return {
      success: true,
      stats,
      message: `Khôi phục thành công: ${stats.quizzes} đề thi, ${stats.bankQuestions} câu ngân hàng, ${stats.users} người dùng, ${stats.classes} lớp học!`
    };
  } catch (err: any) {
    console.error("Lỗi khi khôi phục CSDL Firestore:", err);
    throw new Error(`Lỗi khôi phục: ${err.message || 'Không thể khôi phục'}`);
  }
};
