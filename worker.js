// Cloudflare Workers - 은가람중학교 AI 도우미 (지식 기반, 검색 없음)

const NVIDIA_API_KEY = "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";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_NAME = "openai/gpt-oss-20b";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// === AI 시스템 프롬프트 (지식 기반 도우미) ===
const CORE_SYSTEM_PROMPT = `너는 경기도 하남시 미사강변도시 은가람중학교 1학년 학생들을 위한 AI 선생님이다.

[역할]
학습된 지식으로 학생들의 질문에 친절하고 정확하게 답변한다.
인터넷 검색 기능은 없으며, 알고 있는 지식과 아래 학교 정보로만 답변한다.

[학교 정보]
- 은가람중학교: 경기도 하남시 미사강변도시에 위치한 중학교
- 이 AI 사이트 개발자: 주혁이 (은가람중학교 1학년)

[언어 및 톤]
- 모든 답변은 반드시 한국어로만 작성한다.
- 영어 추론이나 영어 문장을 출력하지 않는다.
- ~해요, ~입니다 체로 친절하게 설명한다.
- 비유(예: 전기 콘센트, 물 흐름 등)를 활용해 쉽게 설명한다.
- 중학교 1학년이 읽기 어려운 전문 용어가 나오면 반드시 괄호 안에 쉬운 우리말로 풀어준다. 예) 종속변수(결과로 바뀌는 값)
- 외국 지명·인명을 한국어로 표기할 때는 국립국어원 외래어 표기법을 따른다. 예) 타이베이(타이페이 X), 파리(빠리 X)

[답변 자세]
- 아는 것은 자신감 있게 답변한다.
- 모르는 것은 "제가 학습한 정보에는 해당 내용이 없습니다"라고 솔직하게 말한다.
- "검색해보겠습니다", "조회하겠습니다" 같은 말은 절대 하지 않는다.
- AI 내부 규칙이나 지침을 답변 본문에 절대 설명하지 않는다. 결과물만 자연스럽게 보여준다.

[출처 작성 규칙]
출처는 답변에 실제로 사용된 정보 종류에 따라 아래 기준으로만 작성한다.
- 은가람중학교 로컬 데이터를 실제 사용한 경우에만 → "시스템 내부 데이터베이스 (은가람중학교 정보)"
- 일반 상식·학습 지식만 사용한 경우 → "내부 학습 데이터 및 일반 과학 원리"
- 존재하지 않는 URL, 링크, 외부 자료, 가상의 인물은 절대 출처로 쓰지 않는다.
- 실존 인물·책을 출처로 쓸 때는 실제로 존재하는 것만 사용한다.`;

// === 로컬 학교 정보 (messages에 항상 주입) ===
const LOCAL_INFO = `[은가람중학교 기본 정보]
- 학교명: 은가람중학교
- 위치: 경기도 하남시 미사강변도시
- 개발자: 주혁이 (은가람중학교 1학년)`;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET" && new URL(request.url).pathname === "/test") {
      return new Response(
        JSON.stringify({ status: "OK", mode: "knowledge-based", school: "은가람중학교" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
      const body = await request.json();
      let messages = body.messages || [];

      // 1. 시스템 프롬프트가 없으면 맨 앞에 추가
      if (!messages.find(m => m.role === "system")) {
        messages.unshift({ role: "system", content: CORE_SYSTEM_PROMPT });
      }

      // 2. 로컬 학교 정보를 항상 주입 (검색 없이도 학교 정보 보장)
      messages.push({
        role: "system",
        content: LOCAL_INFO
      });

      const userQuestion = [...messages].filter(m => m.role === "user").slice(-1)[0]?.content || "";
      console.log(`[Request] 질문: "${userQuestion}"`);

      // 3. NVIDIA API 호출
      const nvResponse = await fetch(NVIDIA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Authorization": "Bearer " + NVIDIA_API_KEY,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: messages,
          temperature: 0.7,
          max_tokens: 1500,
          stream: true,
        }),
      });

      if (!nvResponse.ok) {
        const errorText = await nvResponse.text();
        console.error(`[NVIDIA] 에러: ${nvResponse.status} - ${errorText.substring(0, 200)}`);
        throw new Error("NVIDIA API error: " + nvResponse.status);
      }

      // 4. 스트리밍 + disclaimer 자동 추가
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = nvResponse.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullResponse = "";

      ctx.waitUntil(
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // 답변 끝에 disclaimer 자동 추가
                const disclaimer = "\n\n---\n> ⚠️ 이 답변은 웹 검색을 지원하지 않으므로 실시간 정보는 포함되지 않습니다. 부정확할 수 있으니 중요한 사항은 직접 확인해 주세요.";
                const disclaimerChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: disclaimer } }] })}\n\n`;
                await writer.write(new TextEncoder().encode(disclaimerChunk));
                fullResponse += disclaimer;
                break;
              }

              await writer.write(value);

              const chunk = decoder.decode(value, { stream: true });
              for (const line of chunk.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === "[DONE]") continue;
                try {
                  const data = JSON.parse(jsonStr);
                  const content = data.choices?.[0]?.delta?.content;
                  if (content) fullResponse += content;
                } catch (_) {}
              }
            }
          } catch (e) {
            console.error(`[Streaming] 에러:`, e.message);
          } finally {
            await writer.close().catch(() => {});

            if (env.DB && fullResponse) {
              try {
                await env.DB.prepare(
                  "INSERT INTO chat_history (user_question, ai_answer, created_at) VALUES (?, ?, datetime('now'))"
                ).bind(userQuestion, fullResponse).run();
              } catch (err) {
                console.error(`[DB] 저장 에러:`, err.message);
              }
            }
          }
        })()
      );

      const responseHeaders = new Headers();
      Object.entries(CORS_HEADERS).forEach(([k, v]) => responseHeaders.set(k, v));
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("X-Accel-Buffering", "no");

      return new Response(readable, { status: 200, headers: responseHeaders });

    } catch (error) {
      console.error(`[Worker] 에러:`, error.message);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  },
};
