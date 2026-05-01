// Cloudflare Workers - 탐정형 AI (자율 검색 + 교차 검증 + 신뢰도 기반)

const NVIDIA_API_KEY = "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";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_NAME = "openai/gpt-oss-20b";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 최신 Chrome User-Agent
const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// === 탐정형 AI 시스템 프롬프트 ===
const CORE_SYSTEM_PROMPT = `너는 경기도 하남시 미사강변도시에 위치한 은가람중학교의 AI 탐정 멘토야.

[탐정의 원칙]
1. 너는 검색으로 얻은 사실만 답변의 근거로 삼아.
2. 한 곳에서만 나온 정보는 신뢰하지 마. 최소 2개 이상 출처에서 일치할 때만 확실한 정보로 간주해.
3. 정보가 서로 충돌하면 "데이터 간 불일치가 있어 확인이 어렵습니다"라고 정직하게 말해.
4. 모르는 것을 모른다고 말하는 게 가장 똑똑한 답변이야. 억지로 완성하려다 거짓을 말하지 마.
5. 학습 데이터나 상식으로 답변하지 말고, 검색 결과만 신뢰해.

[검색 결과 해석]
- [확인됨] = 2개 이상 출처에서 일치하는 정보
- [단일 출처] = 한 곳에서만 나온 정보 (신뢰도 낮음)
- [불일치] = 출처 간 정보가 다른 경우
- [검색 실패] = 정보를 찾을 수 없음

[절대 규칙]
- 다른 지역(울산, 성남 등)의 은가람중학교 정보는 절대로 언급하지 마.
- 사용자 강주혁은 이 학교의 1학년 학생이자 이 사이트의 개발자야.

[답변 형식]
## 📌 한 줄 요약
## 🎯 쉬운 설명
## 🔬 핵심 개념
## ✅ 팩트체크 (출처 명시 + 신뢰도 표시)`;

// 최소한의 로컬 정보 (은가람중학교 신원만)
const LOCAL_KNOWLEDGE = {
  "은가람중학교": "경기도 하남시 미사강변도시에 위치한 은가람중학교"
};

// === 로컬 정보 검색 (고유명사만) ===
function searchLocalKnowledge(keyword) {
  console.log(`[Local Search] 검색 키워드: "${keyword}"`);

  for (const [key, value] of Object.entries(LOCAL_KNOWLEDGE)) {
    if (keyword.includes(key)) {
      const result = `[로컬 정보]\n- ${value}`;
      console.log(`[Local Search] 매칭됨: "${key}" → "${value}"`);
      return result;
    }
  }

  console.log(`[Local Search] 로컬 정보에서 매칭되지 않음`);
  return "";
}

// === 자율 검색 쿼리 생성 (Self-Query Reformulation) ===
function generateSearchQueries(keyword) {
  // 초등학교, 중학교, 고등학교 감지
  const isSchool = /학교|초등|중학|고등/.test(keyword);

  const baseQueries = [
    keyword,
    `경기도 하남시 ${keyword}`,
    `${keyword} 미사강변도시`,
    `하남시 ${keyword}`
  ];

  // 학교인 경우 추가 쿼리
  if (isSchool) {
    baseQueries.push(
      `${keyword} 공식 홈페이지`,
      `${keyword} 도로명 주소`,
      `${keyword} 전화번호`,
      `${keyword} 설립연도`,
      `${keyword} 교장`
    );
  }

  return baseQueries;
}

// === 신뢰도 기반 정보 분석 ===
class SearchResultAnalyzer {
  constructor() {
    this.results = new Map(); // key: 정보 내용, value: {sources: [], confidence: 0}
  }

  addResult(source, content) {
    if (!content || content.length < 3) return;

    // 기존 결과와 유사성 검사
    let found = false;
    for (const [key, data] of this.results) {
      if (this.isSimilar(key, content)) {
        data.sources.push(source);
        data.confidence = Math.min(100, data.sources.length * 25);
        found = true;
        break;
      }
    }

    if (!found) {
      this.results.set(content, {
        sources: [source],
        confidence: 25 // 단일 출처는 신뢰도 25%
      });
    }
  }

  isSimilar(str1, str2) {
    // 간단한 유사도 검사 (한국어 포함)
    const s1 = str1.replace(/\s+/g, '');
    const s2 = str2.replace(/\s+/g, '');

    if (s1 === s2) return true;

    // 길이가 비슷하고 많은 부분이 겹치면 유사
    const minLen = Math.min(s1.length, s2.length);
    let match = 0;
    for (let i = 0; i < minLen; i++) {
      if (s1[i] === s2[i]) match++;
    }
    return match / minLen > 0.7;
  }

  getVerifiedData() {
    const verified = [];
    const unverified = [];

    for (const [content, data] of this.results) {
      if (data.confidence >= 50) {
        verified.push({
          content,
          sources: data.sources,
          confidence: data.confidence,
          tag: '[확인됨]'
        });
      } else {
        unverified.push({
          content,
          sources: data.sources,
          confidence: data.confidence,
          tag: '[단일 출처]'
        });
      }
    }

    return { verified, unverified };
  }

  formatForAI() {
    const { verified, unverified } = this.getVerifiedData();
    let result = '';

    if (verified.length > 0) {
      result += '[확인된 정보 (신뢰도 높음)]\n';
      verified.forEach(item => {
        result += `- ${item.content}\n  출처: ${item.sources.join(', ')}\n`;
      });
      result += '\n';
    }

    if (unverified.length > 0) {
      result += '[단일 출처 정보 (신뢰도 낮음 - 참고만)]\n';
      unverified.forEach(item => {
        result += `- ${item.content}\n  출처: ${item.sources[0]}\n`;
      });
      result += '\n';
    }

    if (this.results.size === 0) {
      result = '[검색 결과 없음] 해당 정보를 찾을 수 없습니다.\n';
    }

    result += '\n[주의] 한 출처에서만 나온 정보는 검증되지 않았으므로 신뢰하지 마세요.';
    return result;
  }
}

// === 다중 검색 엔진 ===

// 1. Google News RSS
async function searchGoogleNews(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=ko&gl=KR`;
    console.log(`[Google News] 요청 URL: ${rssUrl}`);
    console.log(`[Google News] User-Agent: ${CHROME_USER_AGENT}`);

    const response = await fetch(rssUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": CHROME_USER_AGENT }
    });

    console.log(`[Google News] 응답 상태: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.log(`[Google News] 실패 - HTTP ${response.status}`);
      return null;
    }

    const text = await response.text();
    console.log(`[Google News] 응답 크기: ${text.length}자`);

    const titleMatches = text.match(/<title>([^<]{10,150})<\/title>/g) || [];
    console.log(`[Google News] 추출된 제목 수: ${titleMatches.length}`);

    const results = ["[Google News]"];

    for (let i = 1; i < Math.min(titleMatches.length, 4); i++) {
      const title = titleMatches[i]?.replace(/<title>|<\/title>/g, "");
      if (title && !title.includes("Subscription")) {
        results.push(`- ${title}`);
      }
    }

    if (results.length > 1) {
      console.log(`[Google News] 최종 결과: ${results.length - 1}개 항목`);
      return results.join("\n");
    } else {
      console.log(`[Google News] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[Google News] 에러:`, e.message);
    console.error(`[Google News] Stack:`, e.stack);
    return null;
  }
}

// 2. Naver News RSS (한국 뉴스)
async function searchNaverNews(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const rssUrl = `https://newssearch.naver.com/search.naver?where=rss&query=${encodedQuery}`;
    console.log(`[Naver News] 요청 URL: ${rssUrl}`);
    console.log(`[Naver News] User-Agent: ${CHROME_USER_AGENT}`);

    const response = await fetch(rssUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": CHROME_USER_AGENT }
    });

    console.log(`[Naver News] 응답 상태: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.log(`[Naver News] 실패 - HTTP ${response.status}`);
      return null;
    }

    const text = await response.text();
    console.log(`[Naver News] 응답 크기: ${text.length}자`);

    const titleMatches = text.match(/<title>([^<]{10,200})<\/title>/g) || [];
    console.log(`[Naver News] 추출된 제목 수: ${titleMatches.length}`);

    const results = ["[Naver News]"];

    for (let i = 1; i < Math.min(titleMatches.length, 4); i++) {
      const title = titleMatches[i]?.replace(/<title>|<\/title>/g, "").trim();
      if (title && title.length > 5 && !title.includes("검색결과")) {
        results.push(`- ${title}`);
      }
    }

    if (results.length > 1) {
      console.log(`[Naver News] 최종 결과: ${results.length - 1}개 항목`);
      return results.join("\n");
    } else {
      console.log(`[Naver News] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[Naver News] 에러:`, e.message);
    console.error(`[Naver News] Stack:`, e.stack);
    return null;
  }
}

// 3. DuckDuckGo API
async function searchDuckDuckGo(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json`;
    console.log(`[DuckDuckGo] 요청 URL: ${ddgUrl}`);

    const response = await fetch(ddgUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": CHROME_USER_AGENT }
    });

    console.log(`[DuckDuckGo] 응답 상태: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.log(`[DuckDuckGo] 실패 - HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[DuckDuckGo] Abstract 길이: ${data.Abstract?.length || 0}자`);
    console.log(`[DuckDuckGo] RelatedTopics 수: ${data.RelatedTopics?.length || 0}`);

    const results = ["[DuckDuckGo Web]"];

    if (data.Abstract && data.Abstract.length > 20) {
      results.push(`- ${data.Abstract.substring(0, 200)}`);
    }

    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      data.RelatedTopics.slice(0, 2).forEach(topic => {
        if (topic.Text && topic.Text.length > 15) {
          results.push(`- ${topic.Text.substring(0, 150)}`);
        }
      });
    }

    if (results.length > 1) {
      console.log(`[DuckDuckGo] 최종 결과: ${results.length - 1}개 항목`);
      return results.join("\n");
    } else {
      console.log(`[DuckDuckGo] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[DuckDuckGo] 에러:`, e.message);
    console.error(`[DuckDuckGo] Stack:`, e.stack);
    return null;
  }
}

// 4. Wikipedia API (한국 위백)
async function searchWikipedia(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const wikiUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&origin=*`;
    console.log(`[Wikipedia] 요청 URL: ${wikiUrl}`);

    const response = await fetch(wikiUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": CHROME_USER_AGENT }
    });

    console.log(`[Wikipedia] 응답 상태: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.log(`[Wikipedia] 실패 - HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const searchResults = data.query?.search || [];
    console.log(`[Wikipedia] 검색 결과 수: ${searchResults.length}`);

    if (searchResults.length === 0) {
      console.log(`[Wikipedia] 검색 결과 없음`);
      return null;
    }

    const results = ["[Wikipedia]"];
    searchResults.slice(0, 2).forEach(item => {
      if (item.title && item.snippet) {
        const cleanSnippet = item.snippet.replace(/<\/?[^>]+(>|$)/g, "");
        results.push(`- ${item.title}: ${cleanSnippet.substring(0, 100)}`);
      }
    });

    if (results.length > 1) {
      console.log(`[Wikipedia] 최종 결과: ${results.length - 1}개 항목`);
      return results.join("\n");
    } else {
      console.log(`[Wikipedia] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[Wikipedia] 에러:`, e.message);
    console.error(`[Wikipedia] Stack:`, e.stack);
    return null;
  }
}

// 5. SearXNG 공개 인스턴스
async function searchSearXNG(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const searxngUrl = `https://searx.be/search?q=${encodedQuery}&format=json`;
    console.log(`[SearXNG] 요청 URL: ${searxngUrl}`);
    console.log(`[SearXNG] User-Agent: ${CHROME_USER_AGENT}`);

    const response = await fetch(searxngUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": CHROME_USER_AGENT }
    });

    console.log(`[SearXNG] 응답 상태: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.log(`[SearXNG] 실패 - HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const resultCount = data.results?.length || 0;
    console.log(`[SearXNG] 검색 결과 수: ${resultCount}`);

    if (!data.results || data.results.length === 0) {
      console.log(`[SearXNG] 검색 결과 없음`);
      return null;
    }

    const results = ["[SearXNG]"];
    data.results.slice(0, 2).forEach(item => {
      if (item.title && item.content) {
        results.push(`- ${item.title}: ${item.content.substring(0, 100)}`);
      }
    });

    if (results.length > 1) {
      console.log(`[SearXNG] 최종 결과: ${results.length - 1}개 항목`);
      return results.join("\n");
    } else {
      console.log(`[SearXNG] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[SearXNG] 에러:`, e.message);
    console.error(`[SearXNG] Stack:`, e.stack);
    return null;
  }
}

// === 자율 검색 + 교차 검증 (Cross-Verification with Confidence Scoring) ===
async function searchWithCrossVerification(keyword) {
  console.log(`[CrossVerify] 시작 - 키워드: "${keyword}"`);

  const queries = generateSearchQueries(keyword);
  console.log(`[CrossVerify] 생성된 쿼리: ${JSON.stringify(queries)}`);

  const analyzer = new SearchResultAnalyzer();

  // 각 쿼리에 대해 모든 검색 엔진 병렬 실행
  for (const query of queries) {
    console.log(`[CrossVerify] 쿼리 처리: "${query}"`);

    try {
      const searches = [
        searchNaverNews(query),
        searchGoogleNews(query),
        searchDuckDuckGo(query),
        searchWikipedia(query),
        searchSearXNG(query)
      ];

      const results = await Promise.all(searches);
      const sourceNames = ['Naver News', 'Google News', 'DuckDuckGo', 'Wikipedia', 'SearXNG'];

      // 결과를 신뢰도 시스템에 추가
      let successCount = 0;
      results.forEach((result, index) => {
        if (result) {
          successCount++;
          const sourceName = sourceNames[index];
          console.log(`[CrossVerify] [${sourceName}] 검색 성공`);

          // 결과에서 실제 내용 추출 (헤더 제거)
          const lines = result.split('\n');
          lines.forEach(line => {
            if (line.startsWith('- ') && line.length > 3) {
              analyzer.addResult(sourceName, line.substring(2));
            }
          });
        } else {
          console.log(`[CrossVerify] [${sourceNames[index]}] 검색 실패 (결과 없음)`);
        }
      });

      console.log(`[CrossVerify] 쿼리 "${query}" 완료: ${successCount}/5 엔진 성공`);
    } catch (e) {
      console.error(`[CrossVerify] 쿼리 처리 중 에러:`, e.message);
      console.error(`[CrossVerify] Stack:`, e.stack);
    }
  }

  const formattedResult = analyzer.formatForAI();
  console.log(`[CrossVerify] 최종 분석 결과 길이: ${formattedResult.length}자`);
  console.log(`[CrossVerify] 저장된 항목 수: ${analyzer.results.size}`);

  return formattedResult;
}

// === 검색 필요성 판단 + 키워드 추출 ===
function extractSearchKeywords(question) {
  // 학교, 장소, 시설, 최신 정보 등을 검색이 필요한 질문으로 판단
  const searchIndicators = [
    "뉴스", "최신", "현재", "지금", "언제", "어디", "누가", "뭐", "정보",
    "학교", "초등학교", "중학교", "고등학교", "학원",
    "도서관", "공원", "병원", "카페", "식당",
    "주소", "전화", "시간", "가격", "위치"
  ];

  const hasSearchKeyword = searchIndicators.some(k => question.includes(k));
  if (!hasSearchKeyword) return null;

  const matches = question.match(/[\p{L}\p{N}가-힣]+/gu) || [];
  return matches.slice(0, 5).join(" ");
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET" && new URL(request.url).pathname === "/test") {
      return new Response(
        JSON.stringify({
          status: "OK",
          school: "Eungaram Middle School (Hanum, Misa)",
          search: "Google News + DuckDuckGo + Wikipedia + SearXNG",
          hallucination_prevention: "Enabled"
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
      const body = await request.json();
      let messages = body.messages || [];

      console.log(`[Request] 요청 시작`);
      console.log(`[Request] 메시지 수: ${messages.length}`);

      // 핵심 SYSTEM_PROMPT 추가 (맨 앞에)
      if (!messages.find(m => m.role === "system")) {
        messages.unshift({ role: "system", content: CORE_SYSTEM_PROMPT });
      }

      const userMessages = messages.filter(m => m.role === "user");
      const userQuestion = userMessages[userMessages.length - 1]?.content || "";
      console.log(`[Request] 사용자 질문: "${userQuestion}"`);
      console.log(`[Request] 질문 길이: ${userQuestion.length}자`);

      // === 탐정형 검색 (자율 최적화 + 교차 검증) ===
      let searchResults = "";
      const searchKeywords = extractSearchKeywords(userQuestion);

      if (searchKeywords) {
        console.log(`[Search] 검색 필요 - 추출된 키워드: "${searchKeywords}"`);

        // 1단계: 은가람중학교 고유명사만 로컬 정보 사용
        if (searchKeywords.includes("은가람")) {
          console.log(`[Search] 로컬 검색 시도`);
          searchResults = searchLocalKnowledge(searchKeywords);
        }

        // 2단계: 다른 정보는 검색으로만 (Hard-coding 금지)
        if (!searchResults) {
          console.log(`[Search] 크로스 검증 검색 시작`);
          searchResults = await searchWithCrossVerification(searchKeywords);
          console.log(`[Search] 크로스 검증 검색 완료 - 결과 길이: ${searchResults.length}자`);
        }
      } else {
        console.log(`[Search] 검색 키워드 추출 실패 (검색 불필요)`);
      }

      // === 검증된 정보만 AI에 전달 ===
      let enhancedMessages = [...messages];
      if (searchResults && !searchResults.includes("[검색 결과 없음]")) {
        const aiContext = `[자율 검색 결과 - 교차 검증됨]\n${searchResults}`;
        console.log(`[AI Input] 검색 결과 포함 - 길이: ${aiContext.length}자`);
        console.log(`[AI Input] 최종 프롬프트:\n${aiContext.substring(0, 500)}...`);
        enhancedMessages.push({
          role: "system",
          content: aiContext
        });
      } else if (searchKeywords) {
        const noResultMsg = `[검색 결과] '${searchKeywords}'에 대해 신뢰할 만한 정보를 찾지 못했습니다. 이 경우 "정확한 정보를 확인할 수 없습니다"라고 말하세요. 추측이나 일반 상식으로 답변하지 마세요.`;
        console.log(`[AI Input] 검색 결과 없음 메시지 추가`);
        enhancedMessages.push({
          role: "system",
          content: noResultMsg
        });
      } else {
        console.log(`[AI Input] 검색 결과 없음 (검색 미수행)`);
      }

      console.log(`[AI Input] 최종 메시지 수: ${enhancedMessages.length}`);

      console.log(`[NVIDIA] API 호출 시작`);
      console.log(`[NVIDIA] 엔드포인트: ${NVIDIA_ENDPOINT}`);
      console.log(`[NVIDIA] 모델: ${MODEL_NAME}`);

      const nvResponse = await fetch(NVIDIA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Authorization": "Bearer " + NVIDIA_API_KEY,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: enhancedMessages,
          temperature: 0.7,
          top_p: 0.9,
          presence_penalty: 0.6,
          max_tokens: body.max_tokens || 1500,
          stream: true,
        }),
      });

      console.log(`[NVIDIA] 응답 상태: ${nvResponse.status} ${nvResponse.statusText}`);

      if (!nvResponse.ok) {
        const errorText = await nvResponse.text();
        console.error(`[NVIDIA] API 에러 - Status: ${nvResponse.status}, Body: ${errorText.substring(0, 200)}`);
        throw new Error("NVIDIA API error: " + nvResponse.status);
      }

      console.log(`[NVIDIA] 스트리밍 시작`);

      // Pass-through 스트리밍
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = nvResponse.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullResponse = "";
      let chunkCount = 0;

      ctx.waitUntil(
        (async () => {
          try {
            console.log(`[Streaming] 시작`);

            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`[Streaming] 완료 - 총 청크: ${chunkCount}, 응답 길이: ${fullResponse.length}자`);
                break;
              }

              await writer.write(value);
              chunkCount++;

              const chunk = decoder.decode(value, { stream: true });
              for (const line of chunk.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === "[DONE]") continue;
                try {
                  const data = JSON.parse(jsonStr);
                  const content = data.choices?.[0]?.delta?.content;
                  if (content) fullResponse += content;
                } catch (e) {
                  console.error(`[Streaming] JSON 파싱 에러:`, e.message);
                }
              }
            }
          } catch (e) {
            console.error(`[Streaming] 에러:`, e.message);
            console.error(`[Streaming] Stack:`, e.stack);
          } finally {
            await writer.close().catch(() => {});
            console.log(`[Streaming] Writer 종료`);

            if (env.DB && fullResponse) {
              try {
                const dbContent = searchResults
                  ? `[검색: ${searchKeywords}]\n${searchResults}\n\n${fullResponse}`
                  : fullResponse;

                console.log(`[DB] 저장 시작 - 질문: "${userQuestion.substring(0, 50)}..."`);

                await env.DB.prepare(
                  "INSERT INTO chat_history (user_question, ai_answer, created_at) VALUES (?, ?, datetime('now'))"
                ).bind(userQuestion, dbContent).run();

                console.log(`[DB] 저장 완료`);
              } catch (err) {
                console.error(`[DB] 저장 에러:`, err.message);
                console.error(`[DB] Stack:`, err.stack);
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
      console.error(`[Worker] 에러 발생:`, error.message);
      console.error(`[Worker] 에러 타입:`, error.name);
      console.error(`[Worker] Stack Trace:`, error.stack);
      console.error(`[Worker] 전체 에러:`, JSON.stringify(error));

      return new Response(
        JSON.stringify({
          error: error.message,
          type: error.name,
          timestamp: new Date().toISOString()
        }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  },
};
