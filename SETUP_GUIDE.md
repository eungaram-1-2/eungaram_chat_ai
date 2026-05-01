# eungaram-1-2_GPT AI 챗봇 - 완전 설정 가이드

## 📋 현재 설정

| 항목 | 값 |
|------|-----|
| **AI 모델** | Google Gemma 9B (경량, 빠름) |
| **온도(Temperature)** | 0.6 (일관성 높음) |
| **Top-P** | 0.9 (최적화) |
| **최대 토큰** | 8192 (적절한 길이) |
| **API** | NVIDIA NIM + Cloudflare Worker |
| **로컬 OCR** | Tesseract + PyPDF2 |

---

## 🚀 빠른 시작

### **1단계: Tesseract OCR 설치 (Windows)**

1. [Tesseract 다운로드](https://github.com/UB-Mannheim/tesseract/wiki)
2. `tesseract-ocr-w64-setup-v5.x.exe` 실행
3. 설치 폴더: `C:\Program Files\Tesseract-OCR` (기본값)
4. 한글 지원 선택 ✅

### **2단계: Python 의존성 설치**

```bash
cd "C:\Users\강주혁\Desktop\03_Study\01_coding\9-1_eungaram_chat_ai"
pip install -r requirements.txt
```

### **3단계: OCR 서버 실행**

```bash
python ocr_server.py
```

출력:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### **4단계: Live Server 실행**

1. VS Code에서 `index.html` 우클릭
2. `Open with Live Server` 선택
3. 브라우저가 열림

---

## 🏗️ 시스템 아키텍처

```
┌─────────────────────────────────────────────────────┐
│  브라우저 (index.html)                              │
│  ├─ 텍스트 입력 & AI 질문 → Cloudflare Worker     │
│  └─ OCR 파일 업로드 → 로컬 서버 (8000)             │
└─────────────────────────────────────────────────────┘
           ↓                          ↓
┌──────────────────────┐   ┌────────────────────┐
│ Cloudflare Worker    │   │ FastAPI 로컬 서버  │
│ (CORS 프록시)        │   │ (Tesseract/PyPDF2) │
│                      │   │                    │
│ URL:                 │   │ http://127.0.0.1   │
│ eungaram-proxy.      │   │ :8000              │
│ msangji170.          │   │                    │
│ workers.dev          │   │ 역할:              │
│                      │   │ - OCR 이미지       │
│ 역할:                │   │ - PDF 텍스트 추출  │
│ - API 키 관리        │   └────────────────────┘
│ - 요청 라우팅        │
└──────────────────────┘
           ↓
┌──────────────────────┐
│ NVIDIA NIM API       │
│ (Gemma 9B 모델)      │
│                      │
│ integrate.api.       │
│ nvidia.com/v1        │
└──────────────────────┘
```

---

## 💾 파일 구조

```
9-1_eungaram_chat_ai/
├── index.html              # 메인 채팅 UI
├── worker.js               # Cloudflare Worker (배포됨)
├── ocr_server.py          # FastAPI OCR 서버 (로컬 실행)
├── requirements.txt        # Python 의존성
├── SETUP_GUIDE.md         # 이 파일
└── eungaram-1-2_GPT_logo.png
```

---

## 🔗 API 엔드포인트

### **로컬 OCR 서버**

#### POST `/extract-text`
```bash
# 요청
curl -X POST "http://127.0.0.1:8000/extract-text" \
  -F "file=@image.png"

# 응답
{
  "success": true,
  "text": "추출된 텍스트...",
  "file_type": "image",
  "char_count": 256
}
```

#### POST `/extract-and-ask`
```bash
curl -X POST "http://127.0.0.1:8000/extract-and-ask" \
  -F "file=@document.pdf" \
  -F "question=이 문서의 핵심은?"

# 응답
{
  "success": true,
  "extracted_text": "문서 내용...",
  "ai_prompt": "AI에 전달할 메시지",
  "char_count": 1024
}
```

### **Cloudflare Worker (배포됨)**

#### POST `/`
```javascript
fetch("https://eungaram-proxy.msangji170.workers.dev", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "google/gemma-9b-it",
    messages: [...],
    temperature: 0.6,
    stream: true
  })
})
```

---

## 🎯 기능 설명

### **1. 텍스트 챗**
- 일반적인 AI 질문/답변
- 실시간 스트리밍 응답
- 마크다운 포맷 지원

### **2. OCR 텍스트 추출**
클립 아이콘 클릭 → 이미지 또는 PDF 선택 → 자동 추출

**지원 형식:**
- 이미지: `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`
- 문서: `.pdf`

**언어:**
- 한글 + 영어 자동 인식

**사용 예:**
1. 교과서 사진 업로드
2. 텍스트 자동 추출
3. "이 내용을 쉽게 설명해줘" → AI 답변

---

## ⚙️ 커스터마이징

### **모델 변경**

`index.html` 라인 1120:
```javascript
model: "google/gemma-9b-it",  // ← 여기 변경

// 다른 옵션:
// "meta-llama/llama-2-7b-chat"
// "mistralai/mistral-7b-instruct"
// "z-ai/glm4.7" (더 강력하지만 느림)
```

### **응답 스타일 조정**

| 파라미터 | 값 | 효과 |
|---------|-----|------|
| temperature | 0.2 | 정확하고 일관적 |
| temperature | 0.6 | **현재 (균형)** |
| temperature | 1.0 | 창의적 |
| top_p | 0.7 | 더 집중적 |
| top_p | 0.9 | **현재 (균형)** |
| max_tokens | 4096 | 짧은 답변 |
| max_tokens | 8192 | **현재** |

### **Tesseract 언어 추가**

`ocr_server.py` 라인 52:
```python
extracted_text = pytesseract.image_to_string(image, lang='kor+eng')
# 다른 언어:
# lang='eng'        # 영어만
# lang='kor'        # 한글만
# lang='kor+eng+jpn' # 한글+영어+일본어
```

---

## 🐛 문제 해결

### **문제: OCR 서버 연결 안 됨**

```
⚠️ 로컬 OCR 서버에 연결할 수 없습니다.
```

**해결:**
```bash
# OCR 서버 실행 확인
python ocr_server.py

# 파이썬 경로 확인
python --version

# 의존성 재설치
pip install -r requirements.txt --force-reinstall
```

### **문제: Tesseract not found**

```
pytesseract.TesseractNotFoundError
```

**해결:**
1. Tesseract 설치 확인: `C:\Program Files\Tesseract-OCR\`
2. `ocr_server.py` 라인 51-55 경로 확인
3. 경로가 다르면 수정:
```python
pytesseract.pytesseract.pytesseract_cmd = r'C:\실제\경로\tesseract.exe'
```

### **문제: Cloudflare Worker 401 에러**

**확인:**
1. Cloudflare 대시보드 → Worker
2. Settings → Variables and Secrets
3. `NVIDIA_API_KEY` 변수 확인
4. "Save and deploy" 클릭

### **문제: 한글 OCR이 안 됨**

Tesseract 재설치:
1. 제어판 → Tesseract-OCR 제거
2. [링크](https://github.com/UB-Mannheim/tesseract/wiki)에서 다시 다운로드
3. 설치 시 **Korean language pack** ✅ 선택

---

## 📱 GitHub Pages 배포

```bash
# 1. git 저장소 초기화 (이미 되어있을 수 있음)
git init
git add .
git commit -m "feat: Gemma 9B + OCR 통합"
git push origin main

# 2. GitHub Pages 활성화
# Settings → Pages → Branch: main 선택

# 3. 배포 확인
# https://github.com/username/repository/settings/pages
```

**주의:** 로컬 OCR 서버 기능은 GitHub Pages에서 작동하지 않습니다.
- `index.html`만 배포 (웹 채팅 기능 O)
- OCR은 로컬에서만 실행

---

## 📊 성능 최적화

### **스트리밍 청크 렌더링**
- 청크 3개마다 한 번에 렌더링 (버퍼링)
- 줄바꿈 감지 시 즉시 렌더링
- 불필요한 DOM 조작 최소화

### **메모리 효율**
- 커서 한 번만 생성
- 이전 응답 유지 (최대 40개 메시지)

### **네트워크 최적화**
- Cloudflare Worker 캐싱
- Stream 응답 (청크 단위)
- CORS 헤더 최적화

---

## 🔐 보안 주의사항

⚠️ **현재 NVIDIA API 키가 Cloudflare에 저장됨**
- Cloudflare Workers 보안 정책 확인
- 프로덕션 환경에서는 추가 인증 필요

---

## 📞 지원

오류 발생 시:
1. 브라우저 콘솔 (F12) 오류 메시지 확인
2. OCR 서버 터미널 로그 확인
3. Cloudflare Worker 로그 확인 (대시보드 → Logs)

---

**마지막 업데이트:** 2026-05-01
**버전:** 1.0 (Gemma 9B + FastAPI OCR)
