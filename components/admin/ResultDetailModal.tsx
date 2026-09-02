
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, CheckCircle2, XCircle, HelpCircle, Info, Lock, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { Result, Quiz, Question } from '../../types';
import LatexText from '../LatexText';
import { isAfter, addMinutes } from 'date-fns';
import { getQuizById } from '../../services/storage';

interface ResultDetailModalProps {
    isOpen: boolean;
    result: Result | null;
    quiz: Quiz | null;
    isAdmin?: boolean;
    onClose: () => void;
}

export default function ResultDetailModal({ isOpen, result, quiz: initialQuiz, isAdmin = false, onClose }: ResultDetailModalProps) {
    const [fullQuiz, setFullQuiz] = useState<Quiz | null>(initialQuiz);
    const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!scrollContainerRef.current) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: 160, behavior: 'smooth' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: -160, behavior: 'smooth' });
            } else if (e.key === 'PageDown' || e.key === ' ') {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: 500, behavior: 'smooth' });
            } else if (e.key === 'PageUp') {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: -500, behavior: 'smooth' });
            } else if (e.key === 'Home') {
                e.preventDefault();
                scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (e.key === 'End') {
                e.preventDefault();
                scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    useEffect(() => {
        setFullQuiz(initialQuiz);
        if (initialQuiz && (!initialQuiz.questions || initialQuiz.questions.length === 0)) {
            setIsLoadingQuiz(true);
            getQuizById(initialQuiz.id).then((fetched) => {
                if (fetched && fetched.questions && fetched.questions.length > 0) {
                    setFullQuiz(fetched);
                }
            }).catch((e) => {
                console.error("Lỗi tải chi tiết đề thi cho modal xem lại:", e);
            }).finally(() => {
                setIsLoadingQuiz(false);
            });
        }
    }, [initialQuiz]);

    if (!isOpen || !result || !initialQuiz) return null;

    const quiz = fullQuiz || initialQuiz;
    const questions = quiz.questions || [];
    const userAnswers = result.userAnswers || {};
    
    // Kiểm tra hết giờ thi cho bài kiểm tra
    const now = new Date();
    const startTime = quiz.startTime ? new Date(quiz.startTime) : null;
    const endTime = quiz.endTime ? new Date(quiz.endTime) : (startTime ? addMinutes(startTime, quiz.durationMinutes) : null);
    const isEnded = endTime ? isAfter(now, endTime) : true;

    // Kiểm tra quyền xem đáp án chi tiết:
    // 1. Giáo viên/Admin luôn xem được mọi chi tiết
    // 2. Bài Luyện tập: Luôn cho học sinh xem đáp án
    // 3. Bài Kiểm tra/Làm bài: Do giáo viên quyết định qua quiz.showResultAnswers (mặc định cho xem nếu không tắt)
    const isAnswersAllowedByTeacher = quiz.showResultAnswers !== false;
    const showDetailAnswers = isAdmin || (quiz.type === 'practice') || (isAnswersAllowedByTeacher && isEnded);

    // Sắp xếp câu hỏi theo thứ tự học sinh đã làm (đã xáo trộn từng phần) hoặc theo thứ tự mặc định
    const orderedQuestions = useMemo(() => {
        if (!questions || questions.length === 0) return [];

        if (result.shuffledQuestionIds && Array.isArray(result.shuffledQuestionIds) && result.shuffledQuestionIds.length > 0) {
            const qMap = new Map(questions.map(q => [q.id, q]));
            const restored: Question[] = [];
            for (const qid of result.shuffledQuestionIds) {
                const q = qMap.get(qid);
                if (q) {
                    restored.push(q);
                    qMap.delete(qid);
                }
            }
            // Thêm các câu còn lại (nếu có bổ sung sau này)
            for (const remaining of qMap.values()) {
                restored.push(remaining);
            }
            return restored;
        }

        const parts = {
            mcq: questions.filter(q => q.type === 'mcq'),
            'group-tf': questions.filter(q => q.type === 'group-tf'),
            short: questions.filter(q => q.type === 'short')
        };
        return [...parts.mcq, ...parts['group-tf'], ...parts.short];
    }, [questions, result.shuffledQuestionIds]);

    const renderQuestionDetail = (q: Question, idx: number) => {
        const ans = userAnswers[q.id];
        let isCorrect = false;

        if (q.type === 'mcq') isCorrect = ans === q.correctAnswer;
        else if (q.type === 'short') {
            const normalize = (val: any) => String(val || '').trim().toLowerCase().replace(/\s/g, '').replace(/,/g, '.');
            const nAns = normalize(ans);
            const nCorrect = normalize(q.correctAnswer);
            if (nAns === nCorrect) isCorrect = true;
            else {
                const numAns = parseFloat(nAns);
                const numCorrect = parseFloat(nCorrect);
                if (nAns !== '' && nCorrect !== '' && !isNaN(numAns) && !isNaN(numCorrect) && Math.abs(numAns - numCorrect) < 0.0001) {
                    isCorrect = true;
                }
            }
        }
        else if (q.type === 'group-tf' && q.subQuestions) {
            const subResults = q.subQuestions.map((sq, i) => ans?.[i] === sq.correctAnswer);
            const subCorrectCount = subResults.filter(r => r === true).length;
            isCorrect = subCorrectCount === q.subQuestions.length;
            (q as any)._isPartial = !isCorrect && subCorrectCount > 0;
            (q as any)._subCorrectCount = subCorrectCount;
        }

        const isPartial = (q as any)._isPartial;

        return (
            <div key={q.id} className={`bg-white p-10 rounded-[2.5rem] border-2 shadow-sm relative transition-all ${showDetailAnswers ? (isCorrect ? 'border-emerald-100' : (isPartial ? 'border-amber-100' : 'border-red-100')) : 'border-slate-100'}`}>
                {showDetailAnswers && (
                    <div className="absolute top-8 right-8 flex items-center gap-2">
                        {isPartial && <span className="bg-amber-100 text-amber-600 text-[8px] font-black px-2 py-1 rounded-md uppercase">Đúng một phần</span>}
                        {isCorrect ? <CheckCircle2 className="text-emerald-500" size={32}/> : (isPartial ? <HelpCircle className="text-amber-500" size={32}/> : <XCircle className="text-red-500" size={32}/>)}
                    </div>
                )}

                <div className="flex items-start gap-4 mb-8">
                    <span className={`text-xs font-black px-4 py-1.5 rounded-xl uppercase shrink-0 ${showDetailAnswers ? (isCorrect ? 'bg-emerald-50 text-emerald-600' : (isPartial ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600')) : 'bg-slate-100 text-slate-500'}`}>Câu {idx + 1}</span>
                    <div className="text-slate-800 text-lg font-bold leading-relaxed pt-1 pr-12"><LatexText text={q.text}/></div>
                </div>

                {q.imageUrl && <div className="mb-8 flex justify-center"><img src={q.imageUrl} className="max-h-64 rounded-2xl border" alt="visual" /></div>}

                {q.type === 'mcq' && q.options && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-10">
                        {q.options.map((opt, oi) => {
                            const label = String.fromCharCode(65 + oi);
                            const isUserChoice = ans === opt;
                            const isRightAns = q.correctAnswer === opt;
                            
                            let stateClasses = "bg-slate-50 border-slate-100 text-slate-500";
                            
                            if (showDetailAnswers) {
                                if (isRightAns) stateClasses = "bg-emerald-50 border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/20";
                                else if (isUserChoice && !isRightAns) stateClasses = "bg-red-50 border-red-500 text-red-700 ring-2 ring-red-500/20";
                            } else {
                                if (isUserChoice) stateClasses = "bg-blue-600 border-blue-600 text-white shadow-lg";
                            }

                            return (
                                <div key={oi} className={`p-4 rounded-2xl border-2 flex items-center gap-4 transition-all ${stateClasses}`}>
                                    <span className={`font-black text-xs ${isUserChoice && !showDetailAnswers ? 'text-white' : 'opacity-50'}`}>{label}.</span>
                                    <div className="font-bold text-sm"><LatexText text={opt}/></div>
                                    {isUserChoice && <span className={`ml-auto text-[8px] font-black uppercase px-2 py-0.5 rounded-md ${!showDetailAnswers ? 'bg-white/20' : 'bg-white/50'}`}>Bạn chọn</span>}
                                </div>
                            );
                        })}
                    </div>
                )}

                {q.type === 'group-tf' && q.subQuestions && (
                    <div className="space-y-4 pl-10">
                        {q.subQuestions.map((sq, si) => {
                            const userVal = ans?.[si];
                            const isSubCorrect = userVal === sq.correctAnswer;
                            return (
                                <div key={si} className={`flex flex-col md:flex-row md:items-center gap-4 p-5 rounded-2xl border-2 transition-all ${showDetailAnswers ? (isSubCorrect ? 'bg-emerald-50/30 border-emerald-100' : 'bg-red-50/30 border-red-100') : 'bg-slate-50 border-slate-100'}`}>
                                    <span className="text-xs font-black text-slate-400 w-6">{String.fromCharCode(97+si)})</span>
                                    <div className="flex-1 text-sm font-bold"><LatexText text={sq.text}/></div>
                                    <div className="flex gap-2 text-[9px] font-black">
                                        {['True', 'False'].map(v => {
                                            let vClasses = "bg-white text-slate-300 border-slate-100 opacity-40";
                                            if (showDetailAnswers) {
                                                if (userVal === v) vClasses = v === sq.correctAnswer ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-red-500 text-white border-red-600';
                                                else if (sq.correctAnswer === v) vClasses = 'bg-white text-emerald-600 border-emerald-100 shadow-sm';
                                            } else {
                                                if (userVal === v) vClasses = 'bg-blue-600 text-white border-blue-700 shadow-md';
                                            }
                                            return (
                                                <div key={v} className={`px-4 py-2 rounded-xl border-2 transition-all ${vClasses}`}>
                                                    {v === 'True' ? 'ĐÚNG' : 'SAI'}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {q.type === 'short' && (
                    <div className="pl-10 space-y-4">
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black text-slate-400 uppercase">Học sinh trả lời:</span>
                            <span className={`px-6 py-3 rounded-xl border-2 font-black ${showDetailAnswers ? (isCorrect ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700') : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                                {ans || '(Trống)'}
                            </span>
                        </div>
                        {showDetailAnswers && !isCorrect && (
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-black text-emerald-600 uppercase">Đáp án đúng:</span>
                                <span className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-black shadow-lg">
                                    {q.correctAnswer}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {showDetailAnswers && q.solution && (
                    <div className="mt-10 pt-8 border-t border-dashed border-slate-100 bg-blue-50/30 -mx-10 -mb-10 p-10 rounded-b-[2.5rem]">
                        <div className="flex items-center gap-2 mb-4 text-blue-600">
                            <Info size={18}/>
                            <h5 className="text-[10px] font-black uppercase tracking-widest">Lời giải chi tiết</h5>
                        </div>
                        <div className="text-slate-600 text-sm italic leading-relaxed"><LatexText text={q.solution}/></div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-slate-900/95 z-[1200] flex items-center justify-center p-4 backdrop-blur-xl animate-fade-in">
            <div className="bg-white rounded-[3.5rem] w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden border-8 border-white shadow-2xl">
                <div className={`p-8 ${showDetailAnswers ? 'bg-emerald-600' : 'bg-slate-800'} text-white flex justify-between items-center shrink-0 transition-colors`}>
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shadow-inner">
                            {showDetailAnswers ? <CheckCircle2 size={28}/> : <Info size={28}/>}
                        </div>
                        <div>
                            <h3 className="text-lg font-black uppercase tracking-tight">Chi tiết bài làm: {result.studentName}</h3>
                            <div className="flex items-center gap-3 mt-1">
                                <p className="text-[10px] font-bold text-white/70 uppercase">
                                    Đề thi: {quiz.title} • Điểm đạt được: <span className="text-white underline">{result.score.toFixed(2)}</span>
                                </p>
                                {result.violationCount && result.violationCount > 0 && (
                                    <span className="bg-red-500/50 text-white px-2 py-0.5 rounded text-[8px] font-black">
                                        VI PHẠM: {result.violationCount} LẦN
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-4 bg-black/20 rounded-2xl hover:bg-red-600 transition-colors"><X/></button>
                </div>

                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-12 bg-slate-50 custom-scrollbar relative">
                    <div className="max-w-3xl mx-auto space-y-10 pb-10">
                        
                        {!showDetailAnswers && (
                            <div className="bg-amber-50 border-2 border-amber-200 p-6 rounded-2xl flex items-center gap-4 text-amber-900 mb-6">
                                <Lock size={24} className="shrink-0 text-amber-600"/>
                                <div>
                                    <p className="font-black uppercase text-xs">
                                        {!isAnswersAllowedByTeacher 
                                            ? 'Giáo viên đã ẩn đáp án bài kiểm tra này' 
                                            : 'Chế độ kiểm tra: Đang diễn ra (Ẩn đáp án)'}
                                    </p>
                                    <p className="text-[11px] font-medium leading-tight mt-0.5 text-amber-800">
                                        {!isAnswersAllowedByTeacher
                                            ? 'Theo quy định của giáo viên, bài kiểm tra này không hiển thị đáp án đúng và lời giải chi tiết. Hệ thống chỉ ghi nhận các phương án bạn đã chọn và điểm số đạt được.'
                                            : 'Bài kiểm tra đang trong khung giờ làm bài. Hệ thống tạm thời chỉ hiển thị các lựa chọn của bạn. Đáp án và lời giải chi tiết sẽ tự động mở sau khi đợt kiểm tra kết thúc.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {isLoadingQuiz ? (
                            <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-400">
                                <Loader2 className="animate-spin text-blue-600" size={36}/>
                                <p className="text-xs font-bold uppercase tracking-wider">Đang tải nội dung câu hỏi bài làm...</p>
                            </div>
                        ) : orderedQuestions.length === 0 ? (
                            <div className="py-20 text-center bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
                                <p className="text-slate-400 font-bold text-xs uppercase italic">Không tìm thấy dữ liệu câu hỏi của đề thi này hoặc đề thi đã được cập nhật.</p>
                            </div>
                        ) : (
                            <>
                                {/* Render theo Phần */}
                                {orderedQuestions.some(q => q.type === 'mcq') && (
                                    <div className="space-y-6">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b-2 border-slate-200 pb-2">PHẦN I. TRẮC NGHIỆM NHIỀU LỰA CHỌN</h4>
                                        {orderedQuestions.filter(q => q.type === 'mcq').map((q) => renderQuestionDetail(q, orderedQuestions.indexOf(q)))}
                                    </div>
                                )}

                                {orderedQuestions.some(q => q.type === 'group-tf') && (
                                    <div className="space-y-6 pt-10">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b-2 border-slate-200 pb-2">PHẦN II. TRẮC NGHIỆM ĐÚNG/SAI</h4>
                                        {orderedQuestions.filter(q => q.type === 'group-tf').map((q) => renderQuestionDetail(q, orderedQuestions.indexOf(q)))}
                                    </div>
                                )}

                                {orderedQuestions.some(q => q.type === 'short') && (
                                    <div className="space-y-6 pt-10">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b-2 border-slate-200 pb-2">PHẦN III. TRẢ LỜI NGẮN</h4>
                                        {orderedQuestions.filter(q => q.type === 'short').map((q) => renderQuestionDetail(q, orderedQuestions.indexOf(q)))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Floating quick navigation */}
                    <div className="sticky bottom-4 float-right flex flex-col gap-2 z-20 pointer-events-auto">
                        <button
                            onClick={() => scrollContainerRef.current?.scrollBy({ top: -450, behavior: 'smooth' })}
                            title="Cuộn lên (Phím mũi tên lên / PageUp)"
                            className="w-11 h-11 bg-white/95 backdrop-blur-md text-slate-700 hover:text-emerald-600 rounded-2xl border-2 border-slate-200 shadow-xl flex items-center justify-center hover:bg-emerald-50 transition-all active:scale-95 group"
                        >
                            <ChevronUp size={20} className="group-hover:-translate-y-0.5 transition-transform" />
                        </button>
                        <button
                            onClick={() => scrollContainerRef.current?.scrollBy({ top: 450, behavior: 'smooth' })}
                            title="Cuộn xuống (Phím mũi tên xuống / PageDown)"
                            className="w-11 h-11 bg-white/95 backdrop-blur-md text-slate-700 hover:text-emerald-600 rounded-2xl border-2 border-slate-200 shadow-xl flex items-center justify-center hover:bg-emerald-50 transition-all active:scale-95 group"
                        >
                            <ChevronDown size={20} className="group-hover:translate-y-0.5 transition-transform" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
