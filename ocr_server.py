"""
FastAPI 로컬 서버 - OCR/PDF 텍스트 추출
실행: python ocr_server.py
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import pytesseract
from PIL import Image
import io
from pypdf import PdfReader
import os

app = FastAPI(title="eungaram-OCR-Server", version="1.0")

# CORS 설정 (index.html에서 접근 가능)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tesseract 경로 (Windows)
# 설치 후 경로 확인: https://github.com/UB-Mannheim/tesseract/wiki
try:
    pytesseract.pytesseract.pytesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
except:
    pass


@app.get("/")
async def health_check():
    """서버 상태 확인"""
    return {
        "status": "✅ OCR Server Running",
        "endpoints": {
            "POST /extract-text": "이미지 또는 PDF에서 텍스트 추출",
            "POST /extract-and-ask": "텍스트 추출 후 AI에 질문"
        }
    }


@app.post("/extract-text")
async def extract_text(file: UploadFile = File(...)):
    """
    이미지 또는 PDF에서 텍스트 추출

    요청:
        - file: 이미지(.png, .jpg) 또는 PDF 파일

    응답:
        {
            "success": true,
            "text": "추출된 텍스트",
            "file_type": "image" | "pdf",
            "char_count": 123
        }
    """
    try:
        file_bytes = await file.read()
        file_ext = file.filename.split('.')[-1].lower()

        extracted_text = ""

        # 이미지 파일 처리
        if file_ext in ['png', 'jpg', 'jpeg', 'gif', 'bmp']:
            image = Image.open(io.BytesIO(file_bytes))
            extracted_text = pytesseract.image_to_string(image, lang='kor+eng')
            file_type = "image"

        # PDF 파일 처리
        elif file_ext == 'pdf':
            pdf_reader = PdfReader(io.BytesIO(file_bytes))
            for page_num in range(len(pdf_reader.pages)):
                page = pdf_reader.pages[page_num]
                extracted_text += page.extract_text() + "\n"
            file_type = "pdf"

        else:
            raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식 (.png, .jpg, .pdf만 가능)")

        # 불필요한 공백 제거
        extracted_text = extracted_text.strip()

        return JSONResponse({
            "success": True,
            "text": extracted_text,
            "file_type": file_type,
            "char_count": len(extracted_text),
            "file_name": file.filename
        })

    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.post("/extract-and-ask")
async def extract_and_ask(
    file: UploadFile = File(...),
    question: str = "이 문서의 주요 내용을 요약해줘"
):
    """
    이미지/PDF 텍스트 추출 후 Cloudflare Worker를 통해 AI 질문

    요청:
        - file: 이미지 또는 PDF
        - question: AI에게 할 질문 (기본값: 요약)

    응답:
        {
            "success": true,
            "extracted_text": "추출된 텍스트",
            "user_question": "사용자 질문",
            "ai_prompt": "AI에 전달할 메시지"
        }
    """
    try:
        # 텍스트 추출
        extract_response = await extract_text(file)
        extract_data = extract_response.body.decode()

        import json
        extracted = json.loads(extract_data)

        if not extracted["success"]:
            raise HTTPException(status_code=400, detail="텍스트 추출 실패")

        text = extracted["text"]

        # AI에 전달할 메시지 구성
        ai_message = f"""다음 문서에서 추출된 텍스트를 읽고 질문에 답해줘:

[문서 내용]
{text}

[질문]
{question}"""

        return JSONResponse({
            "success": True,
            "extracted_text": text[:500] + "..." if len(text) > 500 else text,
            "user_question": question,
            "ai_prompt": ai_message,
            "file_name": file.filename,
            "char_count": len(text)
        })

    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
