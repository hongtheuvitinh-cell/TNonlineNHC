import React, { useState, useMemo, useEffect } from 'react';
import { User, Grade, Result, Quiz, ClassRoom } from '../../types';
import { isDatabaseConnected } from '../../services/storage';
import { getCurrentAcademicYear } from '../../services/academicUtils';
import { 
  Search, UserPlus, Eye, Trash2, FileSpreadsheet, Key, Edit3, 
  ChevronDown, Database, RefreshCw, Loader2, 
  GraduationCap, Check, X, Calendar, UserCheck, Copy, Shield
} from 'lucide-react';

interface StudentManagerProps {
    students: User[];
    results?: Result[]; 
    quizzes?: Quiz[];
    classes?: ClassRoom[];
    teachers?: User[];
    currentUser?: User;
    sSearch: string;
    setSSearch: (val: string) => void;
    sGradeFilter: Grade | 'all';
    setSGradeFilter: (val: Grade | 'all') => void;
    onAdd: () => void;
    onRefresh: () => void;
    onImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onViewDetail: (user: User) => void;
    onEdit: (user: User) => void;
    onDelete: (id: string, name: string) => void;
    onBulkDelete: (ids: string[]) => void;
    onBulkAssignClass?: (studentIds: string[], classInfo: any) => Promise<void>;
    onResetPassword: (user: User) => void;
    totalCount: number;
    onLoadMore: () => void;
    isMoreLoading: boolean;
}

export default function StudentManager({ 
    students, results = [], quizzes = [], classes = [], teachers = [], currentUser, sSearch, setSSearch, sGradeFilter, setSGradeFilter, 
    onAdd, onRefresh, onImportCsv, onViewDetail, onEdit, onDelete, onBulkDelete, onBulkAssignClass, onResetPassword,
    totalCount, onLoadMore, isMoreLoading
}: StudentManagerProps) {
    const isSuperAdmin = currentUser?.role === 'superadmin';
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deleteBulkConfirm, setDeleteBulkConfirm] = useState(false);
    const [sClassFilter, setSClassFilter] = useState<string>('all');
    // Mặc định: Năm hiện hành
    const [sAcademicYearFilter, setSAcademicYearFilter] = useState<string>(() => getCurrentAcademicYear());
    // Mặc định: Học sinh của tôi (dành cho GV) hoặc Tất cả (dành cho SuperAdmin)
    const [sScopeFilter, setSScopeFilter] = useState<'mine' | 'all'>(() => isSuperAdmin ? 'all' : 'mine');
    
    const [isBulkClassModalOpen, setIsBulkClassModalOpen] = useState(false);
    const [targetClassId, setTargetClassId] = useState<string>('');
    const [isAssigning, setIsAssigning] = useState(false);
    const [copiedPassId, setCopiedPassId] = useState<string | null>(null);

    // Map nhanh thông tin giáo viên
    const teacherMap = useMemo(() => {
        const map = new Map<string, User>();
        teachers.forEach(t => {
            if (t.id) map.set(t.id, t);
            if (t.fullName) map.set(t.fullName, t);
        });
        return map;
    }, [teachers]);

    const getTeacherInfoForClass = (c: ClassRoom) => {
        const teacher = c.createdBy ? teacherMap.get(c.createdBy) : (c.teacherName ? teacherMap.get(c.teacherName) : null);
        const tName = teacher?.fullName || c.teacherName;
        const tSub = c.subject || teacher?.subject;
        if (tName && tSub) return `GV: ${tName} (${tSub})`;
        if (tName) return `GV: ${tName}`;
        if (tSub) return `Môn: ${tSub}`;
        return '';
    };

    // Danh sách niên khóa trích xuất từ dữ liệu
    const availableAcademicYears = useMemo(() => {
        const set = new Set<string>();
        // Luôn có năm học hiện hành
        const currYear = getCurrentAcademicYear();
        if (currYear) set.add(currYear);
        
        classes.forEach(c => {
            if (c.academicYear && c.academicYear.trim()) set.add(c.academicYear.trim());
        });
        students.forEach(s => {
            if (s.academicYear && s.academicYear.trim()) set.add(s.academicYear.trim());
        });
        return Array.from(set).sort().reverse();
    }, [classes, students]);

    // Danh sách lớp được tạo phù hợp với Niên khóa và Khối được chọn
    const relevantClasses = useMemo(() => {
        return classes.filter(c => {
            // Lọc theo Niên khóa
            if (sAcademicYearFilter !== 'all' && c.academicYear !== sAcademicYearFilter) return false;
            // Lọc theo Khối
            if (sGradeFilter !== 'all' && String(c.grade) !== String(sGradeFilter)) return false;
            return true;
        }).sort((a, b) => {
            if (b.academicYear !== a.academicYear) return b.academicYear.localeCompare(a.academicYear);
            if (b.grade !== a.grade) return b.grade.localeCompare(a.grade);
            return a.name.localeCompare(b.name);
        });
    }, [classes, sAcademicYearFilter, sGradeFilter]);

    // Tự động reset bộ lọc lớp khi lớp đang chọn không còn nằm trong danh sách phù hợp
    useEffect(() => {
        if (sClassFilter !== 'all' && sClassFilter !== 'unassigned') {
            const isStillValid = relevantClasses.some(c => c.id === sClassFilter);
            if (!isStillValid) {
                setSClassFilter('all');
            }
        }
    }, [relevantClasses, sClassFilter]);

    // Danh sách học sinh đã lọc theo các tiêu chí: Năm học hiện hành, Khối 12, Do giáo viên này thêm/quản lý
    const filtered = useMemo(() => {
        return students.filter(u => {
            // 1. Lọc theo Khối (Mặc định Khối 12)
            if (sGradeFilter !== 'all' && u.grade !== sGradeFilter) return false;

            // 2. Lọc theo Niên khóa (Mặc định Năm hiện hành)
            const studentYear = u.academicYear || classes.find(c => c.id === u.classId || (c.name === u.className && c.grade === u.grade))?.academicYear;
            if (sAcademicYearFilter !== 'all') {
                if (sAcademicYearFilter === 'none' && studentYear) return false;
                if (sAcademicYearFilter !== 'none' && studentYear !== sAcademicYearFilter) return false;
            }

            // 3. Lọc theo Giáo viên tạo / quản lý (Mặc định: 'mine' - do GV này thêm hoặc thuộc lớp GV này)
            if (sScopeFilter === 'mine' && currentUser?.id) {
                const isCreatedByMe = Boolean(u.createdById && u.createdById === currentUser.id);
                
                let isMyClass = false;
                if (u.classId) {
                    const cls = classes.find(c => c.id === u.classId);
                    if (cls && (cls.createdBy === currentUser.id || (currentUser.fullName && cls.teacherName === currentUser.fullName))) {
                        isMyClass = true;
                    }
                }
                if (!isMyClass && u.className) {
                    const clsName = u.className.trim().toLowerCase();
                    const cls = classes.find(c => 
                        c.name.trim().toLowerCase() === clsName && 
                        (!c.academicYear || !u.academicYear || c.academicYear === u.academicYear)
                    );
                    if (cls && (cls.createdBy === currentUser.id || (currentUser.fullName && cls.teacherName === currentUser.fullName))) {
                        isMyClass = true;
                    }
                }

                // Nếu không do GV này tạo và không thuộc lớp do GV này quản lý thì loại bỏ
                if (!isCreatedByMe && !isMyClass) {
                    return false;
                }
            }

            // 4. Lọc theo Lớp học
            if (sClassFilter === 'unassigned') {
                if (u.classId || u.className) return false;
            } else if (sClassFilter !== 'all') {
                const targetClass = classes.find(c => c.id === sClassFilter);
                if (targetClass) {
                    const matchById = u.classId === targetClass.id;
                    const matchByNameAndDetails = u.className === targetClass.name && 
                        (!u.academicYear || u.academicYear === targetClass.academicYear) &&
                        (!u.grade || u.grade === targetClass.grade);
                    if (!matchById && !matchByNameAndDetails) return false;
                } else {
                    if (u.classId !== sClassFilter && u.className !== sClassFilter) return false;
                }
            }

            // 5. Tìm kiếm từ khóa (tên, mã số, lớp, tài khoản)
            if (sSearch.trim()) {
                const q = sSearch.toLowerCase();
                const matchName = u.fullName.toLowerCase().includes(q);
                const matchCode = Boolean(u.studentCode && u.studentCode.toLowerCase().includes(q));
                const matchClass = Boolean(u.className && u.className.toLowerCase().includes(q));
                const matchYear = Boolean(u.academicYear && u.academicYear.toLowerCase().includes(q));
                const matchUsername = Boolean(u.username && u.username.toLowerCase().includes(q));
                if (!matchName && !matchCode && !matchClass && !matchYear && !matchUsername) return false;
            }

            return true;
        });
    }, [students, sGradeFilter, sAcademicYearFilter, sScopeFilter, sClassFilter, sSearch, classes, currentUser]);

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(filtered.map(u => u.id));
        } else {
            setSelectedIds([]);
        }
    };

    const handleToggleStudent = (id: string) => {
        setSelectedIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleBulkDelete = () => {
        if (selectedIds.length === 0) return;
        setDeleteBulkConfirm(true);
    };

    const confirmBulkDelete = () => {
        onBulkDelete(selectedIds);
        setSelectedIds([]);
        setDeleteBulkConfirm(false);
    };

    const handleConfirmBulkAssignClass = async () => {
        if (!onBulkAssignClass || selectedIds.length === 0) return;
        setIsAssigning(true);
        try {
            if (!targetClassId) {
                // Bỏ phân lớp
                await onBulkAssignClass(selectedIds, null);
            } else {
                const found = classes.find(c => c.id === targetClassId);
                if (found) {
                    await onBulkAssignClass(selectedIds, {
                        classId: found.id,
                        className: found.name,
                        academicYear: found.academicYear,
                        grade: found.grade,
                        subject: found.subject
                    });
                }
            }
            setIsBulkClassModalOpen(false);
            setSelectedIds([]);
            setTargetClassId('');
        } catch (e) {
            alert("Lỗi gán lớp hàng loạt.");
        } finally {
            setIsAssigning(false);
        }
    };

    const handleCopyPassword = (pass?: string, id?: string) => {
        if (!pass) return;
        navigator.clipboard.writeText(pass);
        if (id) {
            setCopiedPassId(id);
            setTimeout(() => setCopiedPassId(null), 2000);
        }
    };

    const handleExportCsv = () => {
        const headers = ['Họ và tên', 'Mã số (MAHS)', 'Tài khoản', 'Mật khẩu', 'Khối', 'Lớp', 'Niên khóa', 'Môn học'];
        const rows = filtered.map(u => {
            return [
                `"${u.fullName.replace(/"/g, '""')}"`,
                `"${(u.studentCode || 'N/A').replace(/"/g, '""')}"`,
                `"${(u.username || u.studentCode || '').replace(/"/g, '""')}"`,
                `"${(u.password || '123').replace(/"/g, '""')}"`,
                `"${u.grade || '-'}"`,
                `"${(u.className || 'Chưa phân lớp').replace(/"/g, '""')}"`,
                `"${(u.academicYear || '-').replace(/"/g, '""')}"`,
                `"${(u.subject || 'Chung').replace(/"/g, '""')}"`
            ].join(',');
        });

        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(','), ...rows].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `danh_sach_hoc_sinh_${sGradeFilter !== 'all' ? `K${sGradeFilter}_` : ''}${sAcademicYearFilter !== 'all' ? `${sAcademicYearFilter}_` : ''}${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const isFilteredFromDefaults = sAcademicYearFilter !== getCurrentAcademicYear() || sGradeFilter !== '12' || sScopeFilter !== (isSuperAdmin ? 'all' : 'mine') || sClassFilter !== 'all' || sSearch.trim() !== '';

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Thanh công cụ tìm kiếm và lọc tối ưu băng thông */}
            <div className="bg-white p-6 rounded-[2.5rem] border shadow-sm space-y-4">
                <div className="flex flex-col lg:flex-row justify-between items-center gap-4">
                    {/* Tìm kiếm */}
                    <div className="flex-1 flex gap-3 px-5 py-2 items-center bg-slate-50 border rounded-2xl w-full">
                        <Search className="text-slate-300" size={18}/>
                        <input 
                            className="bg-transparent outline-none text-xs font-black w-full py-2" 
                            placeholder="Tìm kiếm theo Tên học sinh, Mã số (MAHS), Lớp, Niên khóa..." 
                            value={sSearch} 
                            onChange={e => setSSearch(e.target.value)} 
                        />
                    </div>
                    
                    {/* Các nút hành động chính */}
                    <div className="flex gap-2 flex-wrap items-center w-full lg:w-auto">
                        {selectedIds.length > 0 && (
                            <>
                                <button 
                                    onClick={() => {
                                        setTargetClassId('');
                                        setIsBulkClassModalOpen(true);
                                    }} 
                                    className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-indigo-700 shadow-xl transition-all"
                                >
                                    <GraduationCap size={16}/> GÁN LỚP ({selectedIds.length})
                                </button>
                                <button onClick={handleBulkDelete} className="flex items-center gap-2 px-5 py-3 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-black shadow-xl transition-all">
                                    <Trash2 size={16}/> XÓA ({selectedIds.length})
                                </button>
                            </>
                        )}
                        <button onClick={onRefresh} className="flex items-center gap-2 px-4 py-3 bg-slate-100 text-slate-600 border border-slate-200 rounded-2xl hover:bg-slate-900 hover:text-white transition-all text-[10px] font-black uppercase">
                            <RefreshCw size={14}/> Làm mới
                        </button>
                        <button onClick={handleExportCsv} className="flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-blue-700 shadow-lg transition-all">
                            <FileSpreadsheet size={16}/> XUẤT CSV
                        </button>
                        <label className="flex items-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase cursor-pointer hover:bg-emerald-700 shadow-lg transition-all">
                            <FileSpreadsheet size={16}/> NHẬP CSV
                            <input type="file" accept=".csv" className="hidden" onChange={onImportCsv}/>
                        </label>
                        <button onClick={onAdd} className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-[10px] font-black uppercase flex items-center gap-2 hover:bg-black shadow-xl transition-all">
                            <UserPlus size={16}/> THÊM MỚI
                        </button>
                    </div>
                </div>

                {/* Bộ lọc tối ưu: Niên khóa hiện hành, Khối 12, Học sinh của giáo viên này, Lớp học */}
                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
                    <span className="text-[10px] font-black text-slate-400 uppercase">Bộ lọc:</span>

                    {/* 1. Lọc theo Phân quyền / Người thêm (Mặc định: Học sinh của tôi) */}
                    <div className="flex items-center gap-1.5 bg-blue-50/80 px-3 py-1.5 rounded-xl border border-blue-200 shadow-xs">
                        <UserCheck size={14} className="text-blue-600 shrink-0" />
                        <select 
                            className="bg-transparent text-[10px] font-black text-blue-950 uppercase outline-none cursor-pointer"
                            value={sScopeFilter} 
                            onChange={e => setSScopeFilter(e.target.value as 'mine' | 'all')}
                        >
                            <option value="mine">👤 HỌC SINH CỦA TÔI</option>
                            <option value="all">🌐 TẤT CẢ HỌC SINH</option>
                        </select>
                    </div>

                    {/* 2. Lọc theo Niên học (Mặc định: Năm hiện hành) */}
                    <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs">
                        <Calendar size={13} className="text-slate-500 shrink-0" />
                        <select 
                            className="bg-transparent text-[10px] font-black uppercase outline-none cursor-pointer text-slate-800"
                            value={sAcademicYearFilter} 
                            onChange={e => setSAcademicYearFilter(e.target.value)}
                        >
                            <option value="all">📅 TẤT CẢ NIÊN KHÓA</option>
                            {availableAcademicYears.map(yr => (
                                <option key={yr} value={yr}>
                                    NIÊN KHÓA {yr} {yr === getCurrentAcademicYear() ? '★ (Hiện hành)' : ''}
                                </option>
                            ))}
                            <option value="none">CHƯA CÓ NIÊN KHÓA</option>
                        </select>
                    </div>

                    {/* 3. Lọc theo Khối (Mặc định: Khối 12) */}
                    <select 
                        className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black uppercase outline-none cursor-pointer shadow-xs text-slate-800" 
                        value={sGradeFilter} 
                        onChange={e => setSGradeFilter(e.target.value as any)}
                    >
                        <option value="all">🎓 TẤT CẢ KHỐI</option>
                        <option value="12">KHỐI 12 (Mặc định)</option>
                        <option value="11">KHỐI 11</option>
                        <option value="10">KHỐI 10</option>
                    </select>

                    {/* 4. Lọc theo Lớp học (Tự động lọc theo Niên khóa & Khối) */}
                    <div className="flex items-center gap-1.5 bg-indigo-50/70 px-3 py-1.5 rounded-xl border border-indigo-200 shadow-xs">
                        <GraduationCap size={14} className="text-indigo-600 shrink-0" />
                        <select 
                            className="bg-transparent text-[10px] font-black text-indigo-950 uppercase outline-none cursor-pointer max-w-[340px] truncate" 
                            value={sClassFilter} 
                            onChange={e => setSClassFilter(e.target.value)}
                        >
                            <option value="all">🏫 TẤT CẢ LỚP ({relevantClasses.length})</option>
                            <option value="unassigned">⚠️ CHƯA PHÂN LỚP</option>
                            {relevantClasses.map(c => {
                                const tInfo = getTeacherInfoForClass(c);
                                return (
                                    <option key={c.id} value={c.id}>
                                        Lớp {c.name} - K{c.grade} {sAcademicYearFilter === 'all' ? `(${c.academicYear}) ` : ''}{tInfo ? `[${tInfo}]` : ''}
                                    </option>
                                );
                            })}
                        </select>
                    </div>

                    {/* Nút Đặt lại bộ lọc */}
                    {isFilteredFromDefaults && (
                        <button 
                            onClick={() => {
                                setSAcademicYearFilter(getCurrentAcademicYear());
                                setSGradeFilter('12');
                                setSScopeFilter(isSuperAdmin ? 'all' : 'mine');
                                setSClassFilter('all');
                                setSSearch('');
                            }}
                            className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-xl text-[9px] font-black uppercase hover:bg-slate-300 transition-all flex items-center gap-1 shadow-xs"
                            title="Khôi phục bộ lọc mặc định (Năm hiện hành + Khối 12 + Của tôi)"
                        >
                            <X size={12}/> Mặc định ban đầu
                        </button>
                    )}

                    <span className="text-[10px] font-black text-slate-400 ml-auto">
                        Hiển thị: <strong className="text-slate-800">{filtered.length}</strong> / {students.length} học sinh
                    </span>
                </div>
            </div>

            {/* Bảng danh sách học sinh - Chỉ hiển thị thông tin cơ bản để tối ưu băng thông */}
            <div className="bg-white rounded-[2.5rem] border shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-slate-50 border-b text-[10px] font-black uppercase tracking-widest text-slate-400">
                            <th className="p-6 w-12">
                                <input 
                                    type="checkbox" 
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={filtered.length > 0 && selectedIds.length === filtered.length}
                                    onChange={e => handleSelectAll(e.target.checked)}
                                />
                            </th>
                            <th className="p-6 w-16 text-center">STT</th>
                            <th className="p-6">Họ và tên học sinh</th>
                            <th className="p-6 text-center">Mã số (MAHS)</th>
                            <th className="p-6 text-center">Khối</th>
                            <th className="p-6 text-center">Lớp & Niên khóa</th>
                            <th className="p-6 text-center">Mật khẩu</th>
                            <th className="p-6 text-center">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="py-16 text-center text-slate-400">
                                    <GraduationCap className="mx-auto text-slate-300 mb-2" size={36}/>
                                    <p className="text-xs font-black uppercase text-slate-600">Không tìm thấy học sinh phù hợp</p>
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        Vui lòng kiểm tra lại bộ lọc Khối, Niên khóa hoặc thêm mới học sinh vào hệ thống.
                                    </p>
                                </td>
                            </tr>
                        ) : (
                            filtered.map((u, idx) => {
                                const isSelected = selectedIds.includes(u.id);

                                return (
                                    <tr key={u.id} className={`hover:bg-slate-50/80 transition-colors group ${isSelected ? 'bg-blue-50/50' : ''}`}>
                                        <td className="p-6">
                                            <input 
                                                type="checkbox" 
                                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                checked={isSelected}
                                                onChange={() => handleToggleStudent(u.id)}
                                            />
                                        </td>
                                        <td className="p-6 text-center font-mono text-xs font-bold text-slate-400">
                                            {idx + 1}
                                        </td>
                                        <td className="p-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-xs shrink-0 border border-blue-100 uppercase">
                                                    {u.fullName.charAt(0) || 'H'}
                                                </div>
                                                <div>
                                                    <p className="font-black text-slate-800 uppercase text-sm leading-tight">{u.fullName}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        {u.username && (
                                                            <span className="text-[10px] font-mono text-slate-400">
                                                                User: <strong className="text-slate-600">{u.username}</strong>
                                                            </span>
                                                        )}
                                                        {u.createdById === currentUser?.id && (
                                                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                                                Của tôi
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-6 text-center">
                                            <span className="font-black uppercase text-blue-600 bg-blue-50 px-3 py-1 rounded-lg border border-blue-100 text-xs tracking-wider">
                                                {u.studentCode || 'N/A'}
                                            </span>
                                        </td>
                                        <td className="p-6 text-center">
                                            <span className="font-black text-slate-600 bg-slate-100 px-3 py-1 rounded-lg text-xs">
                                                {u.grade ? `Khối ${u.grade}` : '-'}
                                            </span>
                                        </td>
                                        <td className="p-6 text-center">
                                            <div className="inline-flex flex-col items-center gap-1">
                                                {u.className ? (
                                                    <span className="font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-lg text-xs uppercase">
                                                        {u.className}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400 text-xs italic">Chưa phân lớp</span>
                                                )}

                                                {u.academicYear && (
                                                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md font-mono">
                                                        {u.academicYear}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-6 text-center">
                                            <div className="inline-flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                                                <Key size={12} className="text-slate-400"/>
                                                <span className="font-mono text-xs font-bold text-slate-700">{u.password || '123'}</span>
                                                <button 
                                                    type="button"
                                                    onClick={() => handleCopyPassword(u.password || '123', u.id)}
                                                    className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-700 transition-colors"
                                                    title="Sao chép mật khẩu"
                                                >
                                                    {copiedPassId === u.id ? <Check size={12} className="text-emerald-600"/> : <Copy size={12}/>}
                                                </button>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex items-center justify-center gap-2">
                                                {/* Nút Xem chi tiết: Nhấn vào mới kích hoạt tải dữ liệu điểm số, lịch sử thi */}
                                                <button 
                                                    onClick={() => onViewDetail(u)} 
                                                    className="p-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-xs flex items-center gap-1 text-xs font-black uppercase" 
                                                    title="Xem chi tiết kết quả & lịch sử bài làm"
                                                >
                                                    <Eye size={15}/>
                                                    <span className="hidden sm:inline text-[10px]">Chi tiết</span>
                                                </button>
                                                <button onClick={() => onEdit(u)} className="p-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-900 hover:text-white transition-all shadow-xs" title="Sửa thông tin"><Edit3 size={15}/></button>
                                                <button onClick={() => onResetPassword(u)} className="p-2.5 bg-orange-50 text-orange-600 rounded-xl hover:bg-orange-600 hover:text-white transition-all shadow-xs" title="Đặt lại mật khẩu"><Key size={15}/></button>
                                                <button onClick={() => onDelete(u.id, u.fullName)} className="p-2.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors" title="Xóa học sinh"><Trash2 size={15}/></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>

                {students.length < totalCount && isDatabaseConnected() && (
                    <div className="p-8 text-center bg-slate-50/50">
                        <button 
                            onClick={onLoadMore}
                            disabled={isMoreLoading}
                            className="inline-flex items-center gap-2 px-8 py-3 bg-white border-2 border-slate-200 rounded-2xl text-[10px] font-black uppercase text-slate-500 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all shadow-sm disabled:opacity-50"
                        >
                            {isMoreLoading ? <Loader2 className="animate-spin" size={14}/> : <ChevronDown size={14}/>} 
                            Tải thêm từ Cloud (Tổng: {totalCount}, Đã tải: {students.length})
                        </button>
                    </div>
                )}
            </div>

            {/* MODAL BULK GÁN LỚP */}
            {isBulkClassModalOpen && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[5000] flex items-center justify-center p-4">
                    <div className="bg-white max-w-md w-full rounded-[2.5rem] border shadow-2xl p-8 overflow-hidden animate-scale-up space-y-6">
                        <div className="flex items-center gap-3 border-b pb-4">
                            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                                <GraduationCap size={24} />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-slate-900 uppercase">
                                    Gán {selectedIds.length} học sinh vào Lớp
                                </h3>
                                <p className="text-[10px] text-slate-400 font-bold">
                                    Tài khoản & điểm số của học sinh vẫn giữ nguyên
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">
                                Chọn Lớp học & Niên khóa đích:
                            </label>
                            <select
                                className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-xs outline-none focus:border-indigo-500"
                                value={targetClassId}
                                onChange={e => setTargetClassId(e.target.value)}
                            >
                                <option value="">-- Bỏ phân lớp (Trở về Chưa phân lớp) --</option>
                                {classes.map(c => {
                                    const tInfo = getTeacherInfoForClass(c);
                                    return (
                                        <option key={c.id} value={c.id}>
                                            Lớp {c.name} • Niên khóa {c.academicYear} (Khối {c.grade}) {tInfo ? `[${tInfo}]` : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setIsBulkClassModalOpen(false)}
                                className="px-5 py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase hover:bg-slate-200 transition-all"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleConfirmBulkAssignClass}
                                disabled={isAssigning}
                                className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase hover:bg-indigo-700 shadow-lg disabled:opacity-50 transition-all flex items-center gap-2"
                            >
                                <Check size={16} /> {isAssigning ? 'Đang cập nhật...' : 'Xác nhận gán'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL XÁC NHẬN XÓA HÀNG LOẠT */}
            {deleteBulkConfirm && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[5000] flex items-center justify-center p-4">
                    <div className="bg-white max-w-md w-full rounded-3xl border shadow-2xl p-6 overflow-hidden animate-scale-up">
                        <div className="flex items-start gap-4 mb-4">
                            <div className="p-3 bg-red-50 text-red-600 rounded-2xl shrink-0">
                                <Trash2 size={24} className="text-red-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-1 leading-tight">Xóa vĩnh viễn học sinh</h3>
                                <p className="text-xs text-slate-500 font-bold leading-relaxed break-words">
                                    Bạn có chắc muốn xóa vĩnh viễn <strong className="text-slate-800">{selectedIds.length} học sinh</strong> đã chọn? Hành động này sẽ xóa toàn bộ lịch sử điểm số liên quan và <strong className="text-red-600">không thể hoàn tác</strong>.
                                </p>
                            </div>
                        </div>
                        
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setDeleteBulkConfirm(false)} className="px-5 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-[10px] font-black uppercase transition-all">
                                Hủy
                            </button>
                            <button onClick={confirmBulkDelete} className="px-5 py-2.5 bg-red-600 text-white hover:bg-red-700 rounded-xl text-[10px] font-black uppercase transition-all shadow-md shadow-red-100">
                                Xác nhận xóa
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
