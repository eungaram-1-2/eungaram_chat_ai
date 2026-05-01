// Cloudflare Workers - 탐정형 AI (자율 검색 + 교차 검증 + 신뢰도 기반)

const NVIDIA_API_KEY = "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";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_NAME = "openai/gpt-oss-20b";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 최신 Chrome User-Agent (Windows 11)
const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0";

// 공통 요청 헤더 (봇 차단 우회)
const COMMON_HEADERS = {
  "User-Agent": CHROME_USER_AGENT,
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "DNT": "1",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

// === AI 시스템 프롬프트 (주석 처리됨) ===
// const CORE_SYSTEM_PROMPT = `너는 '문서 분석가'다. 절대 검색하는 AI가 아니다.
//
// [핵심 역할 - 반드시 따를 것]
// 너는 사용자가 제공한 텍스트 파일(문서)을 읽고 분석하고 요약하는 분석가다.
// 인터넷 검색을 하지 마. 검색하는 척도 하지 마.
// "검색", "찾아보겠습니다", "조회", "검색했습니다" 같은 말을 절대 하지 마.
// 인터넷이나 외부 소스를 언급하지 마.
//
// [시스템 언어: 한국어 고정]
// 모든 답변은 순수 한국어로만.
// 영어로 생각하지 마. 영어 추론 과정을 절대 출력하지 마.
// 첫 글자부터 한국어로 시작. (예: "## 📌 한 줄 요약"부터 바로 시작)
//
// [데이터 처리 - 필수 규칙]
// 사용자가 제공한 [반드시 읽어야 할 절대적 팩트 데이터]를 읽어라.
// 이 데이터가 절대 진실이다. 내 학습 데이터(2024년 이전)는 무시하라.
// - 데이터가 있으면 → 그것을 기반으로만 답변
// - 데이터가 없으면 → "정확한 정보를 확인할 수 없습니다"라고 명시
//
// [답변 형식 - 절대 규칙]
// 1. 어떤 생각도 출력하지 마. 바로 답변 시작.
// 2. 첫 줄은 반드시 "## 📌 한 줄 요약"으로 시작.
// 3. 그 다음 "## 🎯 설명", "## ✅ 출처"로 계속.
// 4. 추론 과정, 생각, 영어는 절대 금지.
//
// [배경]
// 경기도 하남시 미사강변도시 은가람중학교 1학년을 위한 AI다.
// 주혁이가 이 사이트 개발자다.
// `;

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

// === 자율 검색 쿼리 생성 (최대 3개로 제한 - CF Workers subrequest 한도 대응) ===
function generateSearchQueries(keyword) {
  const isSchool = /학교|초등|중학|고등/.test(keyword);

  if (isSchool) {
    return [
      `경기도 하남시 ${keyword}`,
      `${keyword} 주소 전화번호`,
      `${keyword} 정보`
    ];
  }

  return [
    keyword,
    `경기도 하남시 ${keyword}`,
    `하남 미사 ${keyword}`
  ];
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

    const response = await fetch(rssUrl, {
      signal: AbortSignal.timeout(2000),
      headers: COMMON_HEADERS
    });

    console.log(`[Google News] HTTP 상태: ${response.status}`);

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

    const resultText = results.join("\n");
    console.log(`[Google News] 최종 텍스트 길이: ${resultText.length}자`);

    if (results.length > 1) {
      return resultText;
    } else {
      console.log(`[Google News] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[Google News] 에러:`, e.message);
    return null;
  }
}

// 2. Naver News RSS (한국 뉴스)
async function searchNaverNews(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const rssUrl = `https://newssearch.naver.com/search.naver?where=rss&query=${encodedQuery}`;
    console.log(`[Naver News] 요청 URL: ${rssUrl}`);

    const response = await fetch(rssUrl, {
      signal: AbortSignal.timeout(2000),
      headers: COMMON_HEADERS
    });

    console.log(`[Naver News] HTTP 상태: ${response.status}`);

    if (!response.ok) {
      console.log(`[Naver News] 실패 - HTTP ${response.status}`);
      return null;
    }

    const text = await response.text();
    console.log(`[Naver News] 응답 크기: ${text.length}자`);
    console.log(`[Naver News] 응답 미리보기:`, text.substring(0, 300));

    const titleMatches = text.match(/<title>([^<]{10,200})<\/title>/g) || [];
    console.log(`[Naver News] 추출된 제목 수: ${titleMatches.length}`);
    if (titleMatches.length > 0) {
      console.log(`[Naver News] 첫 3개 제목:`, titleMatches.slice(0, 3));
    }

    const results = ["[Naver News]"];

    for (let i = 1; i < Math.min(titleMatches.length, 4); i++) {
      const title = titleMatches[i]?.replace(/<title>|<\/title>/g, "").trim();
      console.log(`[Naver News] 처리 중: i=${i}, title="${title}", 길이=${title?.length}`);
      if (title && title.length > 5 && !title.includes("검색결과")) {
        results.push(`- ${title}`);
        console.log(`[Naver News] ✓ 추가됨: ${title.substring(0, 50)}`);
      } else {
        console.log(`[Naver News] ✗ 필터링됨: ${title?.substring(0, 50)}`);
      }
    }

    const resultText = results.join("\n");
    console.log(`[Naver News] 최종 결과: ${results.length}개 항목, ${resultText.length}자`);

    if (results.length > 1) {
      console.log(`[Naver News] 반환: OK`);
      return resultText;
    } else {
      console.log(`[Naver News] 반환: NULL (항목 부족)`);
      return null;
    }
  } catch (e) {
    console.error(`[Naver News] 에러:`, e.message);
    return null;
  }
}

// 3. 나무위키 직접 조회 (Jina Reader API - 실제 한국 콘텐츠)
async function searchNamuWiki(query) {
  try {
    // 핵심 키워드만 추출해 나무위키 조회 (공백 제거, 조사 제거)
    const keyword = query.replace(/(경기도|하남시|미사강변도시|주소|전화번호|정보|학교)\s?/g, "").trim() || query;
    const jinaUrl = `https://r.jina.ai/https://namu.wiki/w/${encodeURIComponent(keyword)}`;
    console.log(`[NamuWiki] 조회 키워드: "${keyword}", URL: ${jinaUrl}`);

    const response = await fetch(jinaUrl, {
      signal: AbortSignal.timeout(2000),
      headers: {
        "User-Agent": CHROME_USER_AGENT,
        "Accept": "text/plain",
        "X-Return-Format": "text"
      }
    });

    console.log(`[NamuWiki] HTTP 상태: ${response.status}`);

    if (!response.ok) {
      console.log(`[NamuWiki] 실패 - HTTP ${response.status}`);
      return null;
    }

    const text = await response.text();
    console.log(`[NamuWiki] 응답 크기: ${text.length}자`);

    // 404/존재하지 않는 문서 판별
    if (text.includes("404") || text.includes("문서가 존재하지 않습니다") || text.length < 100) {
      console.log(`[NamuWiki] 문서 없음`);
      return null;
    }

    // 앞부분 600자만 (핵심 요약 영역)
    const excerpt = text.replace(/\n{3,}/g, "\n\n").substring(0, 600);
    const resultText = `[나무위키]\n- ${excerpt}`;
    console.log(`[NamuWiki] 최종 텍스트 길이: ${resultText.length}자`);
    return resultText;
  } catch (e) {
    console.error(`[NamuWiki] 에러:`, e.message);
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
      signal: AbortSignal.timeout(2000),
      headers: COMMON_HEADERS
    });

    console.log(`[Wikipedia] HTTP 상태: ${response.status}`);

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

    const resultText = results.join("\n");
    console.log(`[Wikipedia] 최종 텍스트 길이: ${resultText.length}자`);

    if (results.length > 1) {
      return resultText;
    } else {
      console.log(`[Wikipedia] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[Wikipedia] 에러:`, e.message);
    return null;
  }
}

// 5. SearXNG 공개 인스턴스
async function searchSearXNG(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const searxngUrl = `https://searx.be/search?q=${encodedQuery}&format=json&language=ko`;
    console.log(`[SearXNG] 요청 URL: ${searxngUrl}`);

    const response = await fetch(searxngUrl, {
      signal: AbortSignal.timeout(2000),
      headers: COMMON_HEADERS
    });

    console.log(`[SearXNG] HTTP 상태: ${response.status}`);

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

    const resultText = results.join("\n");
    console.log(`[SearXNG] 최종 텍스트 길이: ${resultText.length}자`);

    if (results.length > 1) {
      return resultText;
    } else {
      console.log(`[SearXNG] 필터링 후 결과 없음`);
      return null;
    }
  } catch (e) {
    console.error(`[SearXNG] 에러:`, e.message);
    return null;
  }
}

// === 자율 검색 + 교차 검증 (Cross-Verification with Confidence Scoring) ===
async function searchWithCrossVerification(keyword) {
  console.log(`[CrossVerify] 시작 - 키워드: "${keyword}"`);

  const queries = generateSearchQueries(keyword);
  console.log(`[CrossVerify] 생성된 쿼리: ${JSON.stringify(queries)}`);

  const analyzer = new SearchResultAnalyzer();

  // 각 쿼리에 대해 3개 검색 엔진만 병렬 실행 (CF Workers subrequest 한도 절감)
  for (const query of queries) {
    console.log(`[CrossVerify] 쿼리 처리: "${query}"`);

    try {
      const searches = [
        searchNaverNews(query),
        searchNamuWiki(query),
        searchSearXNG(query)
      ];

      const results = await Promise.all(searches);
      const sourceNames = ['Naver News', 'NamuWiki', 'SearXNG'];

      // 결과를 신뢰도 시스템에 추가
      let successCount = 0;
      results.forEach((result, index) => {
        const sourceName = sourceNames[index];
        console.log(`[CrossVerify] [${sourceName}] 원본 응답:`, result ? `${result.substring(0, 100)}...` : "NULL/EMPTY");

        if (result) {
          successCount++;
          console.log(`[CrossVerify] [${sourceName}] 검색 성공 - 길이: ${result.length}자`);

          // 결과에서 실제 내용 추출 (헤더 제거)
          const lines = result.split('\n');
          let lineCount = 0;
          lines.forEach(line => {
            if (line.startsWith('- ') && line.length > 3) {
              analyzer.addResult(sourceName, line.substring(2));
              lineCount++;
              console.log(`[CrossVerify] [${sourceName}] 라인 ${lineCount}: ${line.substring(0, 80)}`);
            }
          });
          console.log(`[CrossVerify] [${sourceName}] 총 ${lineCount}개 라인 추출`);
        } else {
          console.log(`[CrossVerify] [${sourceName}] 검색 실패 - 응답 없음`);
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
  console.log(`[CrossVerify] 최종 텍스트:\n${formattedResult.substring(0, 500)}`);

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

  // 한글/영문 단어를 제대로 분리 (공백 또는 특수문자로 구분)
  const matches = question.split(/[\s\.,!?;:\-()]+/).filter(w => w.length > 0);
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

      // === 시스템 프롬프트 추가 (주석 처리됨 - 웹 검색 기능 비활성화) ===
      // 핵심 SYSTEM_PROMPT 추가 (맨 앞에)
      // if (!messages.find(m => m.role === "system")) {
      //   messages.unshift({ role: "system", content: CORE_SYSTEM_PROMPT });
      // }

      // [진단용] 강제 테스트 데이터 주입
      const testData = "은가람중학교는 경기도 하남시 미사강변도시에 위치한 중학교입니다. 주혁이는 이 학교 1학년 학생이자 이 AI 사이트 개발자입니다.";
      console.log(`[TEST_INJECTION] 강제 테스트 데이터 주입:`, testData);
      messages.unshift({
        role: "system",
        content: `[진단용 강제 주입 테스트]\n\n${testData}\n\n이 정보가 AI에게 제대로 전달되었는지 확인하는 테스트입니다.`
      });

      const userMessages = messages.filter(m => m.role === "user");
      const userQuestion = userMessages[userMessages.length - 1]?.content || "";
      console.log(`[Request] 사용자 질문: "${userQuestion}"`);
      console.log(`[Request] 질문 길이: ${userQuestion.length}자`);

      // === 웹 서핑 기능 임시 비활성화 ===
      // 웹 검색 기능은 임시로 주석 처리됨
      let searchResults = "";
      const searchKeywords = extractSearchKeywords(userQuestion);

      if (searchKeywords) {
        console.log(`[Search] 검색 필요 - 추출된 키워드: "${searchKeywords}"`);

        // 1단계: 은가람중학교 고유명사만 로컬 정보 사용
        if (searchKeywords.includes("은가람")) {
          console.log(`[Search] 로컬 검색 시도`);
          searchResults = searchLocalKnowledge(searchKeywords);
        }

        // 2단계: 웹 검색 기능 임시 비활성화
        // if (!searchResults) {
        //   console.log(`[Search] 크로스 검증 검색 시작`);
        //   searchResults = await searchWithCrossVerification(searchKeywords);
        //   console.log(`[Search] 크로스 검증 검색 완료 - 결과 길이: ${searchResults.length}자`);
        // }
      } else {
        console.log(`[Search] 검색 키워드 추출 실패 (검색 불필요)`);
      }

      // === 문서 데이터 강제 주입 (절대 진실로 취급) ===
      let enhancedMessages = [...messages];

      // 검색 결과 여부에 관계없이 항상 강제 주입 (검색 실패해도 데이터 명시)
      let factDataContent = "";

      if (searchResults && searchResults.length >= 50 && !searchResults.includes("[검색 결과 없음]")) {
        // 검색 성공 케이스: 실제 검색 결과 사용
        factDataContent = searchResults.length > 1200 ? searchResults.substring(0, 1200) + "\n[이하 생략]" : searchResults;
        console.log(`[AI Input] 검색 성공 - 데이터 길이: ${factDataContent.length}자`);
      } else {
        // 검색 실패 또는 결과 부족: 강제로 기본 데이터 주입 (절대 정보 부재 상황을 만들지 말 것)
        factDataContent = `[검색 결과 요약]
- 은가람중학교: 경기도 하남시 미사강변도시에 위치한 중학교
- 개발자: 주혁이 (은가람중학교 1학년)`;
        console.log(`[AI Input] 검색 실패 → 기본 데이터로 폴백`);
      }

      const mandatoryFactsContext = `[반드시 읽어야 할 절대적 팩트 데이터]

아래는 주혁이가 제공한 데이터입니다.
이것은 너의 학습 데이터보다 100% 우선합니다.

========================================
${factDataContent}
========================================

[필수 실행 규칙]
1. 위 데이터만으로 답변하라. 다른 것은 추가하지 마라.
2. 이 데이터가 너의 내부 지식과 충돌하면, 데이터를 따라라.
3. 데이터에 없는 질문은 "정확한 정보를 확인할 수 없습니다"라고 명시.
4. 절대 가정, 추측, 지어내기 금지.
5. 절대 "검색했습니다", "조회했습니다" 같은 말 금지.
6. 절대 연기 금지. 팩트만 말하라.`;

      console.log(`[AI Input] 팩트 데이터 강제 주입 (크기: ${factDataContent.length}자)`);
      enhancedMessages.push({ role: "system", content: mandatoryFactsContext });

      console.log(`[AI Input] ========== 최종 메시지 배열 분석 ==========`);
      console.log(`[AI Input] 총 메시지 수: ${enhancedMessages.length}`);
      console.log(`[AI Input] 시스템 메시지: ${enhancedMessages.filter(m => m.role === "system").length}`);
      console.log(`[AI Input] 사용자 메시지: ${enhancedMessages.filter(m => m.role === "user").length}`);
      console.log(`[AI Input] 어시스턴트 메시지: ${enhancedMessages.filter(m => m.role === "assistant").length}`);

      // 각 시스템 메시지의 내용 로깅
      enhancedMessages.forEach((msg, idx) => {
        if (msg.role === "system") {
          console.log(`[AI Input] [${idx}] SYSTEM 메시지 (${msg.content?.length || 0}자):`);
          console.log(`[AI Input]   키워드: ${
            msg.content.includes("[반드시 읽어야 할 절대적 팩트 데이터]") ? "팩트 데이터" :
            msg.content.includes("문서 분석가") ? "CORE_SYSTEM_PROMPT" :
            msg.content.includes("테스트") ? "테스트 데이터" :
            "기타"
          }`);
          console.log(`[AI Input]   미리보기: ${msg.content.substring(0, 150)}`);
        }
      });

      // 최종 메시지 크기 계산 및 로깅
      const totalContextLength = enhancedMessages
        .filter(m => m.role === "system")
        .reduce((sum, m) => sum + (m.content?.length || 0), 0);

      console.log(`[AI Input] 총 시스템 컨텍스트 길이: ${totalContextLength}자`);
      console.log(`[AI Input] ==========================================`);

      console.log(`[NVIDIA] =========== API 호출 준비 ===========`);
      console.log(`[NVIDIA] 엔드포인트: ${NVIDIA_ENDPOINT}`);
      console.log(`[NVIDIA] 모델: ${MODEL_NAME}`);
      console.log(`[NVIDIA] 최대 토큰: 3000`);
      console.log(`[NVIDIA] 전체 시스템 컨텍스트 길이: ${totalContextLength}자`);
      console.log(`[NVIDIA] 메시지 배열 크기: ${enhancedMessages.length}`);
      console.log(`[NVIDIA] 검색 결과 포함 여부: ${searchResults && searchResults.length > 50 ? "YES (강제 주입)" : "NO (안전망 사용)"}`);

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
          temperature: 0.6,
          top_p: 0.9,
          presence_penalty: 0.6,
          max_tokens: 1500,
          stream: true,
          include_reasoning: false,
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

                // === 답변 끝에 자동으로 disclaimer 추가 ===
                const disclaimer = "\n\n# 이 답변은 웹 검색등을 지원하지 않으므로, 실시간 정보 등은 가져오지 못합니다. 따라서 부정확할수도 있다는 점 양해 바랍니다.";
                const disclaimerMessage = `data: ${JSON.stringify({choices:[{delta:{content:disclaimer}}]})}\n\n`;
                await writer.write(new TextEncoder().encode(disclaimerMessage));
                fullResponse += disclaimer;
                console.log(`[Streaming] Disclaimer 추가 완료`);

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
