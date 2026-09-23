# Plex Dashboard (Plex 로그 매니저 & 사용자 활동 대시보드)

> Plex Media Server의 시스템 로그를 실시간 분석하여, 사용자가 직관적으로 이해할 수 있는 자연스러운 한글 활동 타임라인과 가상 분할 로그 통합 뷰어를 제공하는 경량 고성능 대시보드입니다.

---

## 🌟 주요 특징

### 1. 사용자 중심의 한글 활동 타임라인 (활동 피드)
* **불필요한 디버그 파편 제거**: 내부 루프백 포트, 토큰 파라미터, 복잡한 HTTP 프로토콜 로그를 배제하고 실질적인 사용자 이벤트만 정제하여 표시합니다.
* **정밀 기기 식별 & GeoIP 위치 연동**:
  * 단순 User-Agent 문자열에 의존하지 않고, Plex 클라이언트 헤더와 세션 식별자를 분석하여 모바일 모델명(예: `Galaxy Phone`), 데스크탑 PC, Android TV, 웹 브라우저(`Firefox (PC 웹)`) 등을 명확하게 식별합니다.
  * 접속 IP를 기반으로 국가, 시/도, 도시, 통신사(ISP) 정보를 백그라운드 캐싱하여 표시합니다.
* **풍부한 미디어 정보 계층 연동**:
  * Plex 로컬 데이터베이스(`com.plexapp.plugins.library.db`)와 읽기 전용으로 연동하여 단순 에피소드 제목뿐만 아니라 **쇼 명, 시즌 번호, 에피소드 번호**(`쇼 명 [S1E13] - 에피소드 제목`) 또는 영화명과 개봉 연도를 완벽하게 출력합니다.
* **3단 컴팩트 레이아웃**:
  * **1행 (대제목)**: 사용자명(닉네임) · 활동 배지 · 일시 · IP · 위치
  * **2행 (중제목)**: 쇼 명 · 시즌/회차 · 에피소드 명 (클릭 시 Plex Web에서 즉시 열림)
  * **3행 (하위 상세)**: 기기 상세 정보, 진행률(시간 및 퍼센트 바), 전송 용량 등 고유 상세치만 압축 표시
* **Plex Web 공식 다이렉트 딥링크**:
  * Tautulli와 동일하게 서버 로컬 IP/도메인을 노출하지 않고, Plex 고유 `Machine Identifier`와 메타데이터 `RatingKey`를 기반으로 구성된 공식 딥링크(`app.plex.tv/desktop/#!/server/...`)를 지원합니다.
  * 활동 피드 카드 및 분석 화면에서 미디어 제목이나 포스터를 클릭하면 새 탭에서 해당 영상의 Plex 상세 정보 페이지로 즉시 연결됩니다.
* **미디어 포스터 썸네일 표시**:
  * 활동 피드 카드에 해당 영상의 세로형 공식 포스터(쇼의 경우 가로형 에피소드 스크린샷은 배제하고 최소 시즌 포스터 또는 쇼 대표 포스터 적용)를 표시하며, 클릭 시 Plex Web에서 즉시 열립니다.
* **Portainer 스타일 하단 앵커 역스크롤**:
  * 최신 로그가 맨 아래에 위치하며, 마우스 휠을 위로 올리면 과거 활동 로그를 점진적으로 불러옵니다.
### 2. 스트리밍 버퍼 전송과 오프라인 다운로드 구분
* **로그 시그니처 자동 판별**:
  * 영상 재생 중 버퍼링을 위한 청크 전송(`206 Partial Content / Range 요청`)과 기기 영구 보관을 위한 순수 전체 파일 다운로드(`200 OK / Range 없음`)를 분석하여 분리합니다.
* **표시 토글 옵션**:
  * 설정에서 `재생 중 스트리밍 전송도 다운로드에 포함` 옵션을 끄면, 재생 중 버퍼 전송은 숨기고 순수 **오프라인 시청용 다운로드** 내역만 피드에 깔끔하게 남길 수 있습니다.

### 3. 사용자 닉네임 (별칭) 매핑
* Plex 상의 영문 계정 아이디를 사용자가 원하는 친숙한 닉네임(예: `홍길동`, `사용자1` 등)으로 설정할 수 있습니다.
* 닉네임을 변경하는 즉시 드롭다운 필터와 활동 카드, 요약문에 실시간 반영됩니다.

### 4. Plex 로그 로테이션과 무관한 독립 보관소 (SQLite)
* Plex의 자체 로그 회전(`.1.log` ~ `.5.log` 후 자동 삭제)으로 인한 데이터 유실을 방지합니다.
* 백그라운드 증분 수집 데몬이 변경 사항을 주기적으로 확인하여 대시보드 전용 SQLite 데이터베이스에 영구 적재합니다.
* **사용자 정의 보관 주기**: `30일`, `60일`, `90일`, `180일`, `1년`, `무제한(영구 보관)` 중 선택 가능하며 초과 데이터는 자동 정리됩니다.

### 5. 가상 분할 로그 통합 뷰어
* **분할 파일 가상 단일화**:
  * `.5.log` $\rightarrow$ `.4.log` $\rightarrow$ ... $\rightarrow$ `.log`로 나누어진 로그들을 시간순으로 가상 결합하여 하나의 거대한 연속 로그 스트림으로 브라우징할 수 있습니다.
* **역방향 무한 스크롤**:
  * 기본적으로 최신 로그가 맨 아래에 위치하고 스크롤이 하단에 고정되며, 위로 스크롤할 때마다 과거 로그 블록을 실시간 비동기 로딩합니다.
* **실시간 새로고침 (Live Tail)**:
  * 토글 ON 시 2초 주기로 새 로그를 감지하여 하단에 스트리밍합니다.
* **다양한 시스템 로그 및 플러그인 로그 지원**:
  * 메인 로그(`Plex Media Server.log`), 스캐너 로그, 튜너 로그 등을 분류 제공합니다.
  * 로그 디렉토리 내에 플러그인 로그(`PMS Plugin Logs/`)가 존재하는 경우 자동으로 탐지하여 최근 갱신된 순서대로 사이드바에 정렬 표시합니다.


### 6. 서버 통계 & 분석 (Analytics)
Plex 서버의 네트워크 자원 사용량과 미디어 시청 트렌드를 한눈에 파악할 수 있는 종합 분석 대시보드를 제공합니다.

* **대역폭 사용 이력 차트 (Bandwidth History)**:
  * `1시간(1분 단위)`, `3시간(3분 단위)`, `6시간(5분 단위)`, `24시간(15분 단위)` 등 원하는 기간을 선택하여 실시간 트래픽 변동을 직관적인 곡선 그래프로 모니터링할 수 있습니다.
  * **핵심 지표**: 최근 대역폭(Mbps), 최고 피크 대역폭(Mbps), 선택 기간 총 데이터 전송량, 평균 대역폭을 즉시 요약 제공합니다.
  * **LAN / WAN 자동 분류**: 사설 IP(192.168.x, 10.x, 172.x)와 외부 공인 IP를 자동 판별하여 툴팁으로 내부망/외부망 전송량을 구분 안내합니다.
* **시간대별 접속 피크 바 차트 (Peak Hours)**:
  * 하루 24시간(`00시` ~ `23시`) 중 서버가 가장 붐비는 시간대를 바 차트로 시각화합니다.
  * 최대 혼잡 시간(예: `20시`)과 주요 피크 구간(예: `18시 ~ 21시`)을 자동으로 도출하고, 상위 피크 시간대를 Plex 시그니처 골드 컬러로 하이라이트합니다.
  * `[대시보드 활동]` 기준과 `[30일 시청 기록]` 기준을 토글하여 단기/중기 트렌드를 비교할 수 있습니다.
* **최근 30일간 최다 재생 콘텐츠 Top 10**:
  * Plex 데이터베이스와 연동하여 최근 30일간 서버에서 가장 많이 시청된 상위 10개 콘텐츠(드라마/시리즈 및 영화) 순위를 집계합니다.
  * **지능형 계층적 대체 포스터 (Poster Fallback)**: 개별 에피소드나 특정 시즌 포스터가 누락된 경우, 상위 쇼(시리즈)의 대표 포스터 및 배경 팬아트, 로컬 Plex 트랜스코딩 캐시를 순차적으로 자동 탐색하여 썸네일 빈자리 없이 온전한 포스터를 제공합니다.
  * **Plex 원클릭 바로가기**: 포스터 썸네일 및 타이틀 클릭 시 Plex Web 상세 페이지로 즉시 연결됩니다.
  * 1~3위 메달 배지, 미디어 유형 배지, 총 재생 횟수, 고유 시청자 수, 1위 대비 점유율 프로그레스 바를 제공합니다.
  * *(예시: `시리즈 A` [시리즈] 48회 시청 (5명), `영화 B` [영화] 35회 시청 (8명), `시리즈 C` 23회 시청 (4명) 등)*
* **사용자별 추정 데이터 소비량 (1시간 / 1일 / 1달 / 1년 / 전체)**:
  * `1시간`, `1일(24시간)`, `1달(30일)`, `1년(365일)`, `전체(누적)` 등 5가지 기간을 자유롭게 선택하여 각 계정별 네트워크 데이터 소비량(MB/GB/TB)을 정밀 분석합니다.
  * 선택 기간 내 총 전송량, 외부(WAN) 전송량, 내부(LAN) 전송량, 활성 사용자 수 및 1인당 평균 소비량을 한눈에 확인할 수 있습니다.
  * 사용자 닉네임(별칭) 설정이 연동되어 친숙한 이름으로 표시되며, 전체 트래픽 중 개인별 점유율(%) 프로그레스 바와 WAN/LAN 상세치를 제공합니다.
  * *(예시: `사용자A (user_a)`: 289 GB (31.3%), `사용자B (user_b)`: 184 GB (19.9%), `사용자C (user_c)`: 96 GB (10.4%) 등)*
---

## 🏗️ 시스템 아키텍처

```text
[ Plex Media Server ]
  ├── Logs/ (Plex Media Server.log .1 ~ .5, Scanner, PMS Plugin Logs/...)
  └── Plug-in Support/Databases/com.plexapp.plugins.library.db (메타데이터 참조용)
            │
            ▼
[ Plex Dashboard Engine (Bun / TypeScript) ]
  ├── LogCollector (증분 오프셋 추적, 가상 분할 파일 병합 스트리머)
  ├── LogParser (X-Plex 헤더, 세션 상관분석, 기기/스트리밍 판정)
  ├── AnalyticsEngine (대역폭 시계열 집계, 24시간 피크 분석, 30일 Top 10, 월간 사용자 트래픽)
  ├── GeoIP Engine (IP 위치 캐싱 & 일괄 역보정)
  ├── SQLite Storage (activity_logs, user_aliases, settings, ip_location_cache)
  └── REST API & Static Server (HTTP / WebSocket Ready)
            │
            ▼
[ Responsive Web Dashboard ]
  ├── 활동 피드 (사용자별/유형별 필터, 하단 앵커 무한 스크롤, 3단 컴팩트 카드)
  ├── 서버 통계 & 분석 (대역폭 차트, 피크 시간대, Top 10 콘텐츠, 월간 사용자 트래픽)
  ├── 가상 분할 로그 뷰어 (실시간 테일, 로드 줄 수 설정, 역스크롤)
  └── 관리 설정 (닉네임 설정 모달, 보관주기 & 수집주기 설정)

---

## 🚀 설치 및 실행 방법

### 사전 요구사항
* Linux 환경 (Ubuntu, Debian, macOS 등)
* [Bun](https://bun.sh/) 런타임 (`curl -fsSL https://bun.sh/install | bash`)

### 1. 저장소 복제 및 준비
```bash
git clone https://github.com/hyunex/plex-dashboard.git
cd plex-dashboard
```

### 2. 환경 설정 (선택 사항)
기본적으로 표준 Plex 설치 경로를 자동으로 탐지합니다. 사용자 지정 경로가 필요한 경우 환경변수를 설정할 수 있습니다.
```bash
# 기본값
export PORT=32420
export PLEX_LOG_DIR="/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Logs"
export PLEX_DB_PATH="/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db"
```

### 3. 서버 실행
외부 패키지 설치(`npm install` 등)가 필요 없는 제로 디펜던시 구조입니다.
```bash
bun run server.ts
```
서버가 시작되면 `http://<서버IP>:32420` 으로 접속할 수 있습니다.

---

## ⚙️ 백그라운드 서비스 등록 (systemd)

서버 부팅 시 자동으로 실행되도록 `systemd` 서비스로 등록할 수 있습니다.

```ini
# /etc/systemd/system/plex-dashboard.service
[Unit]
Description=Plex User Activity Dashboard & Unified Log Manager
After=network.target plexmediaserver.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/plex-dashboard
ExecStart=/home/ubuntu/.npm-global/bin/bun run server.ts
Restart=always
RestartSec=5
Environment=PORT=32420

[Install]
WantedBy=multi-user.target
```

서비스 활성화:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now plex-dashboard
sudo systemctl status plex-dashboard
```

---

## 🔒 개인정보 및 보안 고려사항
* 본 프로젝트는 서버 내부 통신 토큰이나 미디어 인증 토큰을 저장하거나 외부에 노출하지 않습니다.
* 공개 저장소 배포 시 개인 활동 내역 DB(`data/plex_dashboard.db`) 및 로컬 로그는 `.gitignore` 처리되어 포함되지 않습니다.

---

## 📄 라이선스
MIT License
