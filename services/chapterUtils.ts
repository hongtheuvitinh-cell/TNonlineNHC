import { Chapter, Grade } from '../types';

/**
 * Kiểm tra một tên danh mục / chương có phải là chương trong chương trình học hay không.
 * Loại bỏ hoàn toàn các loại đề thi / kiểm tra cũ: KTTX, KTGK, KTCK, LTĐH...
 */
export const isCurriculumChapter = (name?: string | null): boolean => {
    if (!name || typeof name !== 'string') return false;
    const s = name.trim().toUpperCase();
    if (!s) return false;

    // Danh sách từ khóa của các loại đề kiểm tra không phải là chương học
    const nonCurriculumKeywords = [
        'KTTX',
        'KTGK',
        'KTCK',
        'LTĐH',
        'LTDH',
        'THƯỜNG XUYÊN',
        'GIỮA KỲ',
        'GIỮA KÌ',
        'CUỐI KỲ',
        'CUỐI KÌ',
        'LUYỆN THI ĐẠI HỌC',
        'ÔN THI ĐẠI HỌC',
        'THI ĐẠI HỌC',
        'LUYỆN THI ĐH',
        'THI THỬ',
        'ĐỀ TỔNG HỢP'
    ];

    for (const kw of nonCurriculumKeywords) {
        if (s === kw || s.includes(kw)) {
            return false;
        }
    }

    return true;
};

/**
 * Lọc danh sách chương, chỉ giữ lại các chương trong chương trình học
 */
export const filterCurriculumChapters = (chapters: Chapter[]): Chapter[] => {
    if (!Array.isArray(chapters)) return [];
    return chapters.filter(c => {
        const cName = c.name || (c as any).title || '';
        return isCurriculumChapter(cName);
    });
};

/**
 * Danh mục các chương chuẩn GDPT 2018 cho các môn học và khối lớp
 */
export const STANDARD_CURRICULUM_CHAPTERS: Record<string, Partial<Record<Grade, string[]>>> = {
    'Vật lí': {
        '12': [
            'Chương 1: Vật lí nhiệt',
            'Chương 2: Khí lí tưởng',
            'Chương 3: Từ trường',
            'Chương 4: Hạt nhân nguyên tử'
        ],
        '11': [
            'Chương 1: Dao động',
            'Chương 2: Sóng',
            'Chương 3: Điện trường',
            'Chương 4: Dòng điện không đổi và Mạch điện'
        ],
        '10': [
            'Chương 1: Mở đầu và Động học',
            'Chương 2: Động lực học',
            'Chương 3: Năng lượng, Công và Công suất',
            'Chương 4: Động lượng và Va chạm'
        ]
    },
    'Toán': {
        '12': [
            'Chương 1: Ứng dụng đạo hàm để khảo sát và vẽ đồ thị hàm số',
            'Chương 2: Vectơ và hệ tọa độ trong không gian',
            'Chương 3: Các số đặc trưng đo mức độ phân tán của mẫu số liệu',
            'Chương 4: Nguyên hàm và Tích phân',
            'Chương 5: Phương pháp tọa độ trong không gian',
            'Chương 6: Xác suất có điều kiện'
        ],
        '11': [
            'Chương 1: Hàm số lượng giác và phương trình lượng giác',
            'Chương 2: Dãy số. Cấp số cộng và cấp số nhân',
            'Chương 3: Giới hạn. Hàm số liên tục',
            'Chương 4: Quan hệ song song trong không gian',
            'Chương 5: Đạo hàm'
        ],
        '10': [
            'Chương 1: Mệnh đề và tập hợp',
            'Chương 2: Bất phương trình bậc nhất hai ẩn',
            'Chương 3: Hàm số bậc hai và đồ thị',
            'Chương 4: Hệ thức lượng trong tam giác',
            'Chương 5: Vectơ'
        ]
    },
    'Hóa học': {
        '12': [
            'Chương 1: Este - Lipit',
            'Chương 2: Cacbohiđrat',
            'Chương 3: Hợp chất chứa nitơ (Amin, Amino axit, Peptit, Protein)',
            'Chương 4: Polime và vật liệu polime',
            'Chương 5: Pin điện và điện phân',
            'Chương 6: Đại cương kim loại'
        ],
        '11': [
            'Chương 1: Cân bằng hoá học',
            'Chương 2: Nitrogen và sulfur',
            'Chương 3: Đại cương về hoá học hữu cơ',
            'Chương 4: Hydrocarbon'
        ],
        '10': [
            'Chương 1: Cấu tạo nguyên tử',
            'Chương 2: Bảng tuần hoàn các nguyên tố hoá học',
            'Chương 3: Liên kết hoá học',
            'Chương 4: Phản ứng oxi hoá - khử'
        ]
    },
    'Sinh học': {
        '12': [
            'Chương 1: Di truyền phân tử và di truyền nhiễm sắc thể',
            'Chương 2: Tương tác gen và di truyền học người',
            'Chương 3: Thuyết tiến hóa',
            'Chương 4: Sinh thái học và môi trường'
        ],
        '11': [
            'Chương 1: Trao đổi chất và chuyển hoá năng lượng ở sinh vật',
            'Chương 2: Cảm ứng ở sinh vật',
            'Chương 3: Sinh trưởng và phát triển ở sinh vật',
            'Chương 4: Sinh sản ở sinh vật'
        ],
        '10': [
            'Chương 1: Giới thiệu khái quát chương trình môn Sinh học',
            'Chương 2: Sinh học tế bào',
            'Chương 3: Sinh học vi sinh vật và virus'
        ]
    }
};

export const getStandardChaptersForSubject = (subjectName: string, grade: Grade): string[] => {
    const s = subjectName.toLowerCase().trim();
    if (s.includes('lý') || s.includes('vật lí') || s.includes('vật lý') || s.includes('physic')) {
        return STANDARD_CURRICULUM_CHAPTERS['Vật lí']?.[grade] || [];
    }
    if (s.includes('toán') || s.includes('math')) {
        return STANDARD_CURRICULUM_CHAPTERS['Toán']?.[grade] || [];
    }
    if (s.includes('hóa') || s.includes('chem')) {
        return STANDARD_CURRICULUM_CHAPTERS['Hóa học']?.[grade] || [];
    }
    if (s.includes('sinh') || s.includes('bio')) {
        return STANDARD_CURRICULUM_CHAPTERS['Sinh học']?.[grade] || [];
    }
    return [
        'Chương 1: Kiến thức trọng tâm phần 1',
        'Chương 2: Kiến thức trọng tâm phần 2',
        'Chương 3: Kiến thức trọng tâm phần 3',
        'Chương 4: Kiến thức trọng tâm phần 4'
    ];
};
