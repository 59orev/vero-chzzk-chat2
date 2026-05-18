import { ChzzkClient } from 'chzzk';
import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

// Render에서 콤마(,)로 구분해서 넣은 ID들을 배열로 만듭니다. (예: id1,id2,id3)
const CHANNEL_IDS = process.env.CHANNEL_ID ? process.env.CHANNEL_ID.split(',').map(id => id.trim()) : [];

if (CHANNEL_IDS.length === 0) {
    console.error("에러: CHANNEL_ID 환경변수가 설정되지 않았습니다.");
}

const client = new ChzzkClient();
const chatClients = {}; // 여러 채널의 채팅 클라이언트를 저장할 객체
const liveStates = {};   // 각 채널별 라이브 상태
const recentMessages = {}; // 각 채널별 최근 메시지
const topKeywords = {};    // 각 채널별 탑 키워드

// 초기화
CHANNEL_IDS.forEach(id => {
    liveStates[id] = { isLive: false, currentFile: null };
    recentMessages[id] = [];
    topKeywords[id] = [];
});

app.use(express.static('public'));

async function checkLiveAndConnect(id) {
    try {
        const status = await client.live.getLiveStatus(id);
        
        // 방송 시작 감지
        if (status.accumulateCount > 0 && !liveStates[id].isLive) {
            liveStates[id].isLive = true;
            console.log(`[방송 시작] ${id} 채널 채팅 수집 시작: ${status.liveTitle}`);
            
            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `chat_${id}_${dateStr}_${Date.now()}.csv`;
            const currentCsvPath = path.join(process.cwd(), 'public', filename);
            liveStates[id].currentFile = filename;
            
            fs.writeFileSync(currentCsvPath, '\ufeff시간,유저이름,채팅내용\n');

            chatClients[id] = client.chat({ channelId: id });
            chatClients[id].on('chat', (message) => {
                if (message.profile && message.message) {
                    const time = new Date(message.time).toLocaleTimeString();
                    const username = message.profile.nickname;
                    const text = message.message;
                    const escapedText = text.replace(/"/g, '""');
                    const escapedName = username.replace(/"/g, '""');
                    
                    fs.appendFileSync(currentCsvPath, `"${time}","${escapedName}","${escapedText}"\n`);
                    
                    recentMessages[id].push(text);
                    if (recentMessages[id].length > 300) recentMessages[id].shift();
                    analyzeKeywords(id);
                }
            });
            chatClients[id].connect();
        } 
        // 방송 종료 감지
        else if (status.accumulateCount === 0 && liveStates[id].isLive) {
            liveStates[id].isLive = false;
            console.log(`[방송 종료] ${id} 채널 채팅 수집 중단.`);
            liveStates[id].currentFile = null;
            if (chatClients[id]) {
                chatClients[id].disconnect();
                delete chatClients[id];
            }
        }
    } catch (error) {
        console.error(`${id} 채널 상태 체크 중 에러 발생:`, error);
    }
}

function analyzeKeywords(id) {
    const wordCounts = {};
    const stopWords = ['ㅋ', 'ㅎㅎ', 'ㅠㅠ', '아', '그', '노', '네', '거', '이', '수', '개', '형', '진짜', '좀'];
    recentMessages[id].forEach(msg => {
        const words = msg.split(/\s+/);
        words.forEach(word => {
            const cleanWord = word.replace(/[^\wㄱ-ㅎㅏ-ㅣ가-힣]/g, '');
            if (cleanWord.length >= 2 && !stopWords.includes(cleanWord)) {
                wordCounts[cleanWord] = (wordCounts[cleanWord] || 0) + 1;
            }
        });
    });
    topKeywords[id] = Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5) // 대시보드 복잡도를 낮추기 위해 5개로 조정
        .map(([word, count]) => ({ word, count }));
}

// 모든 채널을 1분마다 체크
function checkAllChannels() {
    CHANNEL_IDS.forEach(id => checkLiveAndConnect(id));
}
setInterval(checkAllChannels, 60000);
checkAllChannels();

// 데이터 전송 API 수정
app.get('/api/status', (req, res) => {
    try {
        const files = fs.readdirSync(path.join(process.cwd(), 'public')).filter(f => f.endsWith('.csv'));
        res.json({
            channels: CHANNEL_IDS.map(id => ({
                id,
                isLive: liveStates[id].isLive,
                currentFile: liveStates[id].currentFile,
                topKeywords: topKeywords[id] || []
            })),
            files
        });
    } catch (e) {
        res.json({ channels: [], files: [] });
    }
});

app.listen(PORT, () => {
    console.log(`멀티 대시보드 서버 가동 포트: ${PORT}`);
});