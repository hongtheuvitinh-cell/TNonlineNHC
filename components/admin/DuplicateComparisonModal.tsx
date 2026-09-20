import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, Sparkles, AlertTriangle, CheckCircle2, ArrowRight, 
  Trash2, Image as ImageIcon, FileText, Check, Layers, 
  Loader2, RefreshCw, Eye, ArrowLeft, Info, HelpCircle, Search, Filter
} from 'lucide-react';
import { Question } from '../../types';
import LatexText from '../LatexText';
import { getQuestionFingerprint } from '../../services/storage';
import { isSameSubject, STANDARD_SUBJECTS, getDisplaySubject } from '../../services/subjectUtils';

export interface DuplicateGroup {
  id: string;
  fingerprint: string;
  questions: Question[];
  suggestedPrimaryId: string;
  status?: 'pending' | 'merged' | 'skipped';
  subject?: string;
}

interface DuplicateComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  bankQuestions: Question[];
  subjectFilter?: string;
  onDeleteBatchQuestions: (ids: string[]) => Promise<void>;
  onSaveBatchQuestions?: (questions: Question[]) => Promise<void>;
  onRefreshBank?: () => Promise<void>;
  showAlert?: (title: string, message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export default function DuplicateComparisonModal({
  isOpen,
  onClose,
  bankQuestions,
  subjectFilter,
  onDeleteBatchQuestions,
  onSaveBatchQuestions,
  onRefreshBank,
  showAlert
}: DuplicateComparisonModalProps) {
  const [activeSubject, setActiveSubject] = useState<string>(subjectFilter || 'all');
  const [activeGroupIndex, setActiveGroupIndex] = useState<number>(0);
  const [primarySelections, setPrimarySelections] = useState<Record<string, string>>({}); // groupId -> selected questionId
  const [groupStatuses, setGroupStatuses] = useState<Record<string, 'pending' | 'merged' | 'skipped'>>({});
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fullBankQuestions, setFullBankQuestions] = useState<Question[]>(bankQuestions || []);

  // Đồng bộ bankQuestions khi props thay đổi hoặc khi modal mở
  useEffect(() => {
    if (isOpen) {
      const uniqueById = new Map<string, Question>();
      (bankQuestions || []).forEach(q => {
        if (q && q.id && !uniqueById.has(q.id)) {
          uniqueById.set(q.id, q);
        }
      });
      setFullBankQuestions(Array.from(uniqueById.values()));
      if (subjectFilter) {
        setActiveSubject(subjectFilter);
      }
    }
  }, [isOpen, bankQuestions, subjectFilter]);

  // Phân tích và gom nhóm TẤT CẢ các câu hỏi trùng lặp theo Fingerprint
  const allDuplicateGroups = useMemo(() => {
    if (!isOpen || !fullBankQuestions || fullBankQuestions.length === 0) return [];

    // BƯỚC 1: Lọc sạch các câu hỏi trùng ID trong mảng bộ nhớ (nếu có do query trùng lặp hoặc phân trang)
    const uniqueByIdMap = new Map<string, Question>();
    for (const q of fullBankQuestions) {
      if (q && q.id && !uniqueByIdMap.has(q.id)) {
        uniqueByIdMap.set(q.id, q);
      }
    }
    const cleanQuestions = Array.from(uniqueByIdMap.values());

    // BƯỚC 2: Gom nhóm theo Fingerprint
    const map = new Map<string, Question[]>();
    for (const q of cleanQuestions) {
      const fp = getQuestionFingerprint(q);
      if (!fp) continue;
      if (!map.has(fp)) {
        map.set(fp, []);
      }
      map.get(fp)!.push(q);
    }

    const groups: DuplicateGroup[] = [];
    map.forEach((items, fp) => {
      // ĐẢM BẢO CHỈ COI LÀ TRÙNG LẶP NẾU CÓ TỪ 2 CÂU HỎI VỚI ID KHÁC NHAU!
      const uniqueInGroup = Array.from(new Map(items.map(q => [q.id, q])).values());
      if (uniqueInGroup.length > 1) {
        // Chấm điểm tìm bản chuẩn đề xuất
        const suggestedPrimary = uniqueInGroup.reduce((best, cur) => {
          let scoreBest = 0;
          let scoreCur = 0;
          if (best.imageUrl) scoreBest += 3;
          if (best.solution && best.solution.trim().length > 5) scoreBest += 2;
          if (best.level) scoreBest += 1;
          if (best.createdByName) scoreBest += 1;

          if (cur.imageUrl) scoreCur += 3;
          if (cur.solution && cur.solution.trim().length > 5) scoreCur += 2;
          if (cur.level) scoreCur += 1;
          if (cur.createdByName) scoreCur += 1;

          return scoreCur > scoreBest ? cur : best;
        }, uniqueInGroup[0]);

        const groupSubject = uniqueInGroup.find(q => q.subject)?.subject || 'Chung';

        // Tạo ID nhóm ổn định từ fingerprint để không bị lệch trạng thái khi danh sách thay đổi
        let hash = 0;
        for (let i = 0; i < fp.length; i++) {
          hash = ((hash << 5) - hash) + fp.charCodeAt(i);
          hash |= 0;
        }
        const stableGroupId = `grp_${Math.abs(hash).toString(36)}`;

        groups.push({
          id: stableGroupId,
          fingerprint: fp,
          questions: uniqueInGroup,
          suggestedPrimaryId: suggestedPrimary.id,
          status: 'pending',
          subject: groupSubject
        });
      }
    });

    return groups;
  }, [isOpen, fullBankQuestions]);

  // Đếm số nhóm trùng lặp theo từng môn học
  const duplicateCountsBySubject = useMemo(() => {
    const counts: Record<string, number> = { all: allDuplicateGroups.length };
    
    for (const s of STANDARD_SUBJECTS) {
      counts[s] = 0;
    }

    allDuplicateGroups.forEach(g => {
      const matchedSubject = STANDARD_SUBJECTS.find(s => 
        g.questions.some(q => q.subject && isSameSubject(q.subject, s))
      );
      if (matchedSubject) {
        counts[matchedSubject] = (counts[matchedSubject] || 0) + 1;
      }
    });

    return counts;
  }, [allDuplicateGroups]);

  // Lọc nhóm theo môn học đang chọn và từ khóa tìm kiếm
  const filteredDuplicateGroups = useMemo(() => {
    let list = allDuplicateGroups;

    // 1. Lọc môn học
    if (activeSubject && activeSubject !== 'all') {
      list = list.filter(g => 
        g.questions.some(q => !q.subject || isSameSubject(q.subject, activeSubject))
      );
    }

    // 2. Lọc từ khóa tìm kiếm
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      list = list.filter(g => 
        g.questions.some(q => 
          (q.text && q.text.toLowerCase().includes(query)) ||
          (q.id && q.id.toLowerCase().includes(query)) ||
          (q.quizTitle && q.quizTitle.toLowerCase().includes(query)) ||
          (q.quizCategory && q.quizCategory.toLowerCase().includes(query))
        )
      );
    }

    return list;
  }, [allDuplicateGroups, activeSubject, searchQuery]);

  // Khởi tạo bản chọn chính ban đầu theo gợi ý
  useEffect(() => {
    if (filteredDuplicateGroups.length > 0) {
      const initialSelections: Record<string, string> = {};
      filteredDuplicateGroups.forEach(g => {
        if (!primarySelections[g.id]) {
          initialSelections[g.id] = g.suggestedPrimaryId;
        }
      });
      setPrimarySelections(prev => ({ ...initialSelections, ...prev }));
    }
  }, [filteredDuplicateGroups]);

  // Điều chỉnh index đang xem khi danh sách thay đổi
  useEffect(() => {
    if (activeGroupIndex >= filteredDuplicateGroups.length) {
      setActiveGroupIndex(Math.max(0, filteredDuplicateGroups.length - 1));
    }
  }, [filteredDuplicateGroups.length]);

  if (!isOpen) return null;

  const currentGroup = filteredDuplicateGroups[activeGroupIndex];
  const totalGroups = filteredDuplicateGroups.length;
  const pendingGroupsCount = filteredDuplicateGroups.filter(g => (groupStatuses[g.id] || 'pending') === 'pending').length;
  const allSubjectsTotalDupes = allDuplicateGroups.length;

  // Xử lý gộp 1 nhóm cụ thể
  const handleMergeCurrentGroup = async (group: DuplicateGroup) => {
    const chosenPrimaryId = primarySelections[group.id] || group.suggestedPrimaryId;
    let primaryIndex = group.questions.findIndex(q => q.id === chosenPrimaryId);
    if (primaryIndex === -1) primaryIndex = 0;
    const primary = group.questions[primaryIndex];
    const duplicateQuestions = group.questions.filter((_, idx) => idx !== primaryIndex);
    // Tuyệt đối không xóa bản ghi chính (primary.id)
    const idsToDelete = duplicateQuestions
      .map(q => q.id)
      .filter(id => Boolean(id) && id !== primary.id);

    setIsProcessing(true);
    try {
      // 1. Tạo bản câu hỏi gộp: Bổ sung hình ảnh, lời giải, level từ các bản sao nếu bản chính chưa có
      const merged: Question = { ...primary };
      for (const item of duplicateQuestions) {
        if (!merged.imageUrl && item.imageUrl) merged.imageUrl = item.imageUrl;
        if ((!merged.solution || merged.solution.trim().length < 5) && item.solution) merged.solution = item.solution;
        if (!merged.level && item.level) merged.level = item.level;
        if (!merged.subject && item.subject) merged.subject = item.subject;
        if (!merged.quizCategory && item.quizCategory) merged.quizCategory = item.quizCategory;
        if (!merged.quizGrade && item.quizGrade) merged.quizGrade = item.quizGrade;
      }

      // 2. Xóa các ID bản sao
      if (idsToDelete.length > 0) {
        await onDeleteBatchQuestions(idsToDelete);
      }

      // 3. Cập nhật bản chính nếu có thông tin mới
      if (onSaveBatchQuestions && (
        merged.imageUrl !== primary.imageUrl || 
        merged.solution !== primary.solution || 
        merged.level !== primary.level
      )) {
        await onSaveBatchQuestions([merged]);
      }

      // Cập nhật trạng thái
      setGroupStatuses(prev => ({ ...prev, [group.id]: 'merged' }));
      
      // Xóa các câu hỏi trùng khỏi bộ nhớ local
      setFullBankQuestions(prev => {
        const deletedIdSet = new Set(idsToDelete);
        return prev.filter(q => !deletedIdSet.has(q.id));
      });

      if (showAlert) {
        showAlert(
          "Gộp thành công", 
          `Đã giữ bản chính (ID: ${primary.id}) và xóa ${idsToDelete.length} bản sao trùng lặp khỏi Ngân hàng.`, 
          "success"
        );
      }

      // Tự động chuyển sang nhóm tiếp theo chưa xử lý
      const nextPendingIndex = filteredDuplicateGroups.findIndex((g, i) => i > activeGroupIndex && (groupStatuses[g.id] || 'pending') === 'pending');
      if (nextPendingIndex !== -1) {
        setActiveGroupIndex(nextPendingIndex);
      }

      if (onRefreshBank) {
        onRefreshBank().catch(() => {});
      }
    } catch (err: any) {
      if (showAlert) {
        showAlert("Lỗi gộp câu hỏi", err?.message || "Không thể hoàn thành thao tác gộp.", "error");
      } else {
        alert("Lỗi: " + (err?.message || "Không thể gộp"));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Xử lý gộp tất cả các nhóm còn lại một lần
  const handleMergeAllRemaining = async () => {
    const pendingGroups = filteredDuplicateGroups.filter(g => (groupStatuses[g.id] || 'pending') === 'pending');
    if (pendingGroups.length === 0) return;

    if (!confirm(`Bạn có chắc chắn muốn tự động gộp tất cả ${pendingGroups.length} nhóm câu hỏi trùng lặp? Hệ thống sẽ giữ lại bản chuẩn hoàn thiện nhất của mỗi nhóm và dọn dẹp các bản sao thừa.`)) {
      return;
    }

    setIsProcessing(true);
    try {
      const allIdsToDelete: string[] = [];
      const questionsToUpdate: Question[] = [];

      for (const group of pendingGroups) {
        const chosenPrimaryId = primarySelections[group.id] || group.suggestedPrimaryId;
        let primaryIndex = group.questions.findIndex(q => q.id === chosenPrimaryId);
        if (primaryIndex === -1) primaryIndex = 0;
        const primary = group.questions[primaryIndex];
        const duplicateQuestions = group.questions.filter((_, idx) => idx !== primaryIndex);

        duplicateQuestions.forEach(d => {
          if (d.id && d.id !== primary.id && !allIdsToDelete.includes(d.id)) {
            allIdsToDelete.push(d.id);
          }
        });

        const merged: Question = { ...primary };
        for (const item of duplicateQuestions) {
          if (!merged.imageUrl && item.imageUrl) merged.imageUrl = item.imageUrl;
          if ((!merged.solution || merged.solution.trim().length < 5) && item.solution) merged.solution = item.solution;
          if (!merged.level && item.level) merged.level = item.level;
          if (!merged.subject && item.subject) merged.subject = item.subject;
          if (!merged.quizCategory && item.quizCategory) merged.quizCategory = item.quizCategory;
          if (!merged.quizGrade && item.quizGrade) merged.quizGrade = item.quizGrade;
        }

        if (
          merged.imageUrl !== primary.imageUrl || 
          merged.solution !== primary.solution || 
          merged.level !== primary.level
        ) {
          questionsToUpdate.push(merged);
        }
      }

      if (allIdsToDelete.length > 0) {
        await onDeleteBatchQuestions(allIdsToDelete);
      }

      if (onSaveBatchQuestions && questionsToUpdate.length > 0) {
        await onSaveBatchQuestions(questionsToUpdate);
      }

      const updatedStatuses: Record<string, 'merged'> = {};
      pendingGroups.forEach(g => {
        updatedStatuses[g.id] = 'merged';
      });
      setGroupStatuses(prev => ({ ...prev, ...updatedStatuses }));

      // Xóa các câu hỏi trùng khỏi bộ nhớ local
      setFullBankQuestions(prev => {
        const deletedIdSet = new Set(allIdsToDelete);
        return prev.filter(q => !deletedIdSet.has(q.id));
      });

      if (showAlert) {
        showAlert(
          "Hoàn tất gộp tự động", 
          `Đã gộp thành công ${pendingGroups.length} nhóm trùng lặp và loại bỏ ${allIdsToDelete.length} bản sao khỏi Ngân hàng câu hỏi!`, 
          "success"
        );
      }

      if (onRefreshBank) {
        await onRefreshBank();
      }
    } catch (err: any) {
      if (showAlert) {
        showAlert("Lỗi gộp tự động", err?.message || "Không thể hoàn thành thao tác gộp tự động.", "error");
      } else {
        alert("Lỗi: " + (err?.message || "Không thể gộp"));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Xóa riêng lẻ 1 câu hỏi cụ thể
  const handleDeleteSingleQuestion = async (group: DuplicateGroup, questionId: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa câu hỏi (ID: ${questionId}) khỏi Ngân hàng?`)) return;

    setIsProcessing(true);
    try {
      await onDeleteBatchQuestions([questionId]);
      
      // Cập nhật lại danh sách câu hỏi trong nhóm ở local state
      group.questions = group.questions.filter(q => q.id !== questionId);
      if (group.questions.length <= 1) {
        setGroupStatuses(prev => ({ ...prev, [group.id]: 'merged' }));
      }
      
      setFullBankQuestions(prev => prev.filter(q => q.id !== questionId));

      if (showAlert) {
        showAlert("Đã xóa", `Đã xóa câu hỏi khỏi Ngân hàng thành công!`, "success");
      }

      if (onRefreshBank) {
        onRefreshBank().catch(() => {});
      }
    } catch (err: any) {
      if (showAlert) {
        showAlert("Lỗi", err?.message || "Không thể xóa câu hỏi", "error");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Danh sách các môn có câu hỏi trùng lặp
  const subjectsWithDupes = STANDARD_SUBJECTS.filter(s => (duplicateCountsBySubject[s] || 0) > 0);

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[4500] flex items-center justify-center p-2 sm:p-4 animate-fade-in">
      <div className="bg-slate-100 w-full max-w-7xl h-[95vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border-4 border-white">
        
        {/* MODAL HEADER */}
        <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
              <Layers size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black uppercase tracking-tight">
                  SO SÁNH & XỬ LÝ CÂU HỎI TRÙNG LẶP
                </h2>
              </div>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                Tìm thấy <span className="text-amber-400 font-bold">{totalGroups}</span> nhóm trùng lặp 
                {activeSubject !== 'all' ? ` (Môn ${getDisplaySubject(activeSubject)})` : ' (Tất cả các môn)'}
                {pendingGroupsCount > 0 ? ` • Còn ${pendingGroupsCount} nhóm cần xử lý` : ' • Đã xử lý tất cả'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {pendingGroupsCount > 1 && (
              <button
                type="button"
                onClick={handleMergeAllRemaining}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-xl text-xs font-black uppercase shadow-md transition-all active:scale-95 disabled:opacity-50"
                title="Tự động gộp tất cả các nhóm trùng lặp theo bản chuẩn tốt nhất"
              >
                {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Gộp tất cả ({pendingGroupsCount} nhóm)
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
              title="Đóng cửa sổ"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* THANH CHỌN MÔN HỌC (SUBJECT SELECTOR BAR) */}
        <div className="px-6 py-2.5 bg-slate-800/90 border-b border-slate-700/80 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-thin">
          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider shrink-0 flex items-center gap-1 mr-1">
            <Filter size={12} /> Bộ lọc môn:
          </span>
          
          <button
            type="button"
            onClick={() => {
              setActiveSubject('all');
              setActiveGroupIndex(0);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all shrink-0 flex items-center gap-1.5 ${
              activeSubject === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
            }`}
          >
            Tất cả các môn
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeSubject === 'all' ? 'bg-blue-800 text-white' : 'bg-slate-800 text-amber-400 font-bold'
            }`}>
              {duplicateCountsBySubject.all || 0}
            </span>
          </button>

          {STANDARD_SUBJECTS.map(subj => {
            const count = duplicateCountsBySubject[subj] || 0;
            const isSelected = isSameSubject(activeSubject, subj);

            return (
              <button
                key={subj}
                type="button"
                onClick={() => {
                  setActiveSubject(subj);
                  setActiveGroupIndex(0);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm font-black'
                    : count > 0
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                {getDisplaySubject(subj)}
                {count > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                    isSelected ? 'bg-blue-800 text-white' : 'bg-amber-500 text-slate-900'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* NỘI DUNG CHÍNH */}
        {totalGroups === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center bg-white m-4 rounded-3xl shadow-sm overflow-y-auto">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mb-4">
              <CheckCircle2 size={36} />
            </div>
            
            <h3 className="text-lg font-black text-slate-800 uppercase">
              {activeSubject !== 'all' 
                ? `Không có câu hỏi trùng lặp trong môn ${getDisplaySubject(activeSubject)}!` 
                : 'Không có câu hỏi nào bị trùng lặp!'}
            </h3>
            
            <p className="text-xs text-slate-500 max-w-md mt-1.5 font-medium leading-relaxed">
              {activeSubject !== 'all' ? (
                <>
                  Ngân hàng câu hỏi <b className="text-slate-800">môn {getDisplaySubject(activeSubject)}</b> hiện đang sạch sẽ và không phát hiện nội dung trùng lặp nào.
                </>
              ) : (
                'Toàn bộ Ngân hàng câu hỏi của tất cả các môn hiện đang hoàn toàn sạch sẽ và tối ưu. Tất cả câu hỏi đều có nội dung độc nhất.'
              )}
            </p>

            {/* Gợi ý nếu các môn khác có trùng lặp */}
            {activeSubject !== 'all' && allSubjectsTotalDupes > 0 && (
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl max-w-lg w-full text-left space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-amber-900 uppercase">
                  <AlertTriangle size={15} className="text-amber-600" />
                  Phát hiện {allSubjectsTotalDupes} nhóm trùng lặp ở các môn khác:
                </div>
                
                <div className="flex flex-wrap gap-2 pt-1">
                  {subjectsWithDupes.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setActiveSubject(s);
                        setActiveGroupIndex(0);
                      }}
                      className="px-3 py-1 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                    >
                      Môn {getDisplaySubject(s)}: <b className="text-amber-700">({duplicateCountsBySubject[s]} nhóm)</b>
                    </button>
                  ))}
                </div>

                <div className="pt-2 border-t border-amber-200/60 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSubject('all');
                      setActiveGroupIndex(0);
                    }}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase transition-all shadow-xs"
                  >
                    Xem tất cả các môn ({allSubjectsTotalDupes} nhóm)
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={onClose}
              className="mt-6 px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase hover:bg-blue-600 transition-all shadow"
            >
              Đóng cửa sổ
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            
            {/* CỘT TRÁI: DANH SÁCH CÁC NHÓM TRÙNG LẶP */}
            <div className="w-full md:w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
              <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 uppercase">
                  <span>Danh sách nhóm ({totalGroups})</span>
                  <span className="text-[10px] text-slate-500 font-bold">
                    Còn {pendingGroupsCount}
                  </span>
                </div>

                {/* Thanh tìm kiếm nhanh */}
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm câu hỏi, ID, đề..."
                    className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {filteredDuplicateGroups.map((group, gIdx) => {
                  const status = groupStatuses[group.id] || 'pending';
                  const isCurrent = gIdx === activeGroupIndex;

                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setActiveGroupIndex(gIdx)}
                      className={`w-full text-left p-3 rounded-2xl transition-all border flex flex-col gap-1.5 relative ${
                        isCurrent
                          ? 'bg-blue-50/80 border-blue-400 shadow-sm ring-2 ring-blue-500/20'
                          : status === 'merged'
                          ? 'bg-slate-50 border-slate-200/80 opacity-60 hover:opacity-100'
                          : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-[11px] font-black uppercase ${isCurrent ? 'text-blue-700' : 'text-slate-800'}`}>
                          Nhóm #{gIdx + 1} ({group.questions.length} câu)
                        </span>
                        {status === 'merged' ? (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-black flex items-center gap-0.5">
                            <Check size={10} /> Đã gộp
                          </span>
                        ) : status === 'skipped' ? (
                          <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-black">
                            Đã bỏ qua
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[9px] font-black">
                            Trùng lặp
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500 line-clamp-2 font-medium">
                        {group.questions[0]?.text?.replace(/<[^>]*>?/gm, '') || 'Nội dung câu hỏi...'}
                      </p>

                      <div className="flex items-center justify-between gap-1 text-[9px] text-slate-400 font-bold">
                        <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                          {group.subject || 'Chung'}
                        </span>
                        <div className="flex items-center gap-1">
                          {group.questions.some(q => q.imageUrl) && (
                            <span className="flex items-center gap-0.5 text-purple-600 bg-purple-50 px-1 rounded">
                              <ImageIcon size={9} /> Có ảnh
                            </span>
                          )}
                          {group.questions.some(q => q.solution) && (
                            <span className="flex items-center gap-0.5 text-blue-600 bg-blue-50 px-1 rounded">
                              <FileText size={9} /> Có giải
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CỘT PHẢI: KHÔNG GIAN SO SÁNH CHI TIẾT TỪNG BẢN SAO TRONG NHÓM */}
            {currentGroup && (
              <div className="flex-1 flex flex-col overflow-hidden bg-slate-100">
                
                {/* THANH ĐIỀU HƯỚNG NHÓM TRÊN CÙNG */}
                <div className="p-3.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeGroupIndex <= 0}
                      onClick={() => setActiveGroupIndex(i => Math.max(0, i - 1))}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 disabled:opacity-30 transition-all"
                      title="Nhóm trước"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <span className="text-xs font-black text-slate-800 uppercase">
                      Nhóm #{activeGroupIndex + 1} / {totalGroups}
                    </span>
                    <button
                      type="button"
                      disabled={activeGroupIndex >= totalGroups - 1}
                      onClick={() => setActiveGroupIndex(i => Math.min(totalGroups - 1, i + 1))}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 disabled:opacity-30 transition-all"
                      title="Nhóm tiếp theo"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setGroupStatuses(prev => ({ ...prev, [currentGroup.id]: 'skipped' }));
                        if (activeGroupIndex < totalGroups - 1) {
                          setActiveGroupIndex(i => i + 1);
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                    >
                      Bỏ qua nhóm này
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing || groupStatuses[currentGroup.id] === 'merged'}
                      onClick={() => handleMergeCurrentGroup(currentGroup)}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase shadow-md transition-all active:scale-95 disabled:opacity-40"
                    >
                      {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      {groupStatuses[currentGroup.id] === 'merged' ? 'Đã gộp xong' : 'Gộp nhóm này (Giữ bản đã chọn)'}
                    </button>
                  </div>
                </div>

                {/* HỘP HƯỚNG DẪN / GIẢI THÍCH QUY TẮC GỘP */}
                <div className="px-5 pt-3 pb-1">
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5">
                    <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 leading-relaxed">
                      <span className="font-bold">Quy tắc gộp câu hỏi thông minh:</span>
                      <p className="text-[11px] text-amber-800">
                        Chọn <b className="text-emerald-800 underline">Bản chính giữ lại</b> bên dưới (hệ thống đã tự động chọn bản đầy đủ nhất). Khi gộp, ID bản chính sẽ được giữ nguyên, mọi hình ảnh và lời giải còn thiếu sẽ được tự động chuyển giao vào bản chính trước khi các bản sao thừa bị xóa khỏi Ngân hàng.
                      </p>
                    </div>
                  </div>
                </div>

                {/* SO SÁNH SONG SONG CÁC BẢN CÂU HỎI TRONG NHÓM */}
                <div className="flex-1 overflow-y-auto p-5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {currentGroup.questions.map((q, qIndex) => {
                      const selectedPrimaryId = primarySelections[currentGroup.id] || currentGroup.suggestedPrimaryId;
                      let primaryIndex = currentGroup.questions.findIndex(item => item.id === selectedPrimaryId);
                      if (primaryIndex === -1) primaryIndex = 0;
                      const isSelectedAsPrimary = qIndex === primaryIndex;
                      
                      let suggestedIndex = currentGroup.questions.findIndex(item => item.id === currentGroup.suggestedPrimaryId);
                      if (suggestedIndex === -1) suggestedIndex = 0;
                      const isSuggested = qIndex === suggestedIndex;

                      return (
                        <div
                          key={`${q.id || 'q'}-${qIndex}`}
                          className={`bg-white rounded-3xl p-5 border-2 transition-all shadow-sm flex flex-col justify-between relative ${
                            isSelectedAsPrimary
                              ? 'border-emerald-500 ring-4 ring-emerald-500/10'
                              : 'border-slate-200/90 hover:border-slate-300'
                          }`}
                        >
                          <div className="space-y-4">
                            {/* Card Header */}
                            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                              <div className="flex items-center gap-2">
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${
                                  isSelectedAsPrimary ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                                }`}>
                                  {String.fromCharCode(65 + qIndex)}
                                </span>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-black text-slate-800">
                                      Phiên bản #{qIndex + 1}
                                    </span>
                                    {isSuggested && (
                                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md text-[9px] font-black uppercase flex items-center gap-0.5">
                                        ⭐ Bản chuẩn đề xuất
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-mono block">
                                    ID: {q.id}
                                  </span>
                                </div>
                              </div>

                              {/* Nút chọn bản chính */}
                              <button
                                type="button"
                                onClick={() => {
                                  setPrimarySelections(prev => ({ ...prev, [currentGroup.id]: q.id }));
                                }}
                                className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-1.5 ${
                                  isSelectedAsPrimary
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                              >
                                {isSelectedAsPrimary ? (
                                  <>
                                    <Check size={13} strokeWidth={3} /> Đang chọn giữ bản này
                                  </>
                                ) : (
                                  'Chọn giữ bản này'
                                )}
                              </button>
                            </div>

                            {/* Metadata Pills */}
                            <div className="flex flex-wrap gap-1.5 text-[10px] font-bold text-slate-600">
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg">
                                Môn: {q.subject || 'Chưa rõ'}
                              </span>
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg">
                                Khối: {q.quizGrade || 'Chưa rõ'}
                              </span>
                              <span className={`px-2 py-0.5 rounded-lg ${
                                q.level ? 'bg-purple-50 text-purple-700 font-black' : 'bg-slate-100 text-slate-400'
                              }`}>
                                Mức độ: {q.level || 'Chưa phân loại'}
                              </span>
                              {q.quizTitle && (
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-800 rounded-lg max-w-[180px] truncate" title={q.quizTitle}>
                                  Đề: {q.quizTitle}
                                </span>
                              )}
                              {q.createdByName && (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded-lg">
                                  GV: {q.createdByName}
                                </span>
                              )}
                            </div>

                            {/* Nội dung câu hỏi (Render LaTeX) */}
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">
                                Nội dung câu hỏi:
                              </label>
                              <div className="p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80 text-xs text-slate-800 leading-relaxed font-medium overflow-x-auto">
                                <LatexText text={q.text || '*Nội dung trống*'} />
                              </div>
                            </div>

                            {/* Hình ảnh đính kèm (nếu có) */}
                            {q.imageUrl && (
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-purple-600 flex items-center gap-1 tracking-wider">
                                  <ImageIcon size={12} /> Hình ảnh đính kèm:
                                </label>
                                <div className="relative group border rounded-2xl p-2 bg-slate-50 flex items-center justify-center max-h-48 overflow-hidden">
                                  <img 
                                    src={q.imageUrl} 
                                    alt="Minh họa" 
                                    className="max-h-44 object-contain rounded-xl cursor-pointer group-hover:scale-105 transition-all"
                                    onClick={() => setPreviewImage(q.imageUrl || null)}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Các phương án trắc nghiệm */}
                            {q.options && q.options.length > 0 && (
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">
                                  Các phương án lựa chọn:
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {q.options.map((opt, optIdx) => {
                                    const optLabel = String.fromCharCode(65 + optIdx);
                                    const isCorrect = String(q.correctAnswer ?? '') === String(optIdx) || q.correctAnswer === opt || q.correctAnswer === optLabel;

                                    return (
                                      <div
                                        key={optIdx}
                                        className={`p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
                                          isCorrect
                                            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 font-bold'
                                            : 'bg-slate-50/50 border-slate-200 text-slate-700'
                                        }`}
                                      >
                                        <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0 ${
                                          isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                                        }`}>
                                          {optLabel}
                                        </span>
                                        <div className="flex-1 overflow-x-auto">
                                          <LatexText text={opt} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Lời giải chi tiết (nếu có) */}
                            {q.solution && q.solution.trim().length > 0 && (
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-blue-600 flex items-center gap-1 tracking-wider">
                                  <FileText size={12} /> Lời giải chi tiết:
                                </label>
                                <div className="p-3 bg-blue-50/50 rounded-2xl border border-blue-200/80 text-xs text-blue-950 leading-relaxed overflow-x-auto">
                                  <LatexText text={q.solution} />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Footer của từng bản sao */}
                          <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                            <div className="text-[11px] text-slate-400 font-medium">
                              {isSelectedAsPrimary ? (
                                <span className="text-emerald-600 font-bold flex items-center gap-1">
                                  <CheckCircle2 size={13} /> Giữ lại trong ngân hàng
                                </span>
                              ) : (
                                <span className="text-amber-700 font-medium">
                                  Sẽ bị xóa khi gộp
                                </span>
                              )}
                            </div>

                            {!isSelectedAsPrimary && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSingleQuestion(currentGroup, q.id)}
                                disabled={isProcessing}
                                className="px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1"
                                title="Xóa riêng bản sao này"
                              >
                                <Trash2 size={12} /> Xóa bản này
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MODAL PHÓNG TO HÌNH ẢNH */}
        {previewImage && (
          <div 
            className="fixed inset-0 bg-black/90 z-[5000] flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setPreviewImage(null)}
          >
            <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white p-2">
              <img 
                src={previewImage} 
                alt="Preview" 
                className="max-h-[85vh] object-contain mx-auto" 
              />
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="absolute top-4 right-4 p-2 bg-slate-900/80 text-white rounded-full hover:bg-slate-900 transition-all"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
