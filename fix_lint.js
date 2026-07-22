const fs = require('fs');
let text = fs.readFileSync('server/src/index.ts', 'utf8');

// 4:29 'PlayerId' is defined but never used
// 4:39 'ClientMessage' is defined but never used
// 4:54 'ServerMessage' is defined but never used
text = text.replace(/PlayerId, ClientMessage, ServerMessage, /, '');

// 31:25 'roomCode' is defined but never used
// 31:43 'room' is defined but never used
text = text.replace(/function startTurnTimer\(roomCode: string, room: any\) \{/g, 'function startTurnTimer(_roomCode: string, _room: any) {');

// 481:29 'roomCode' is assigned a value but never used
text = text.replace(/const roomCode = req\.body\.roomCode;/g, '// roomCode removed');

// 544:19 'meta' is assigned a value but never used
text = text.replace(/const meta = null;/g, '// const meta = null;');

// 553:19 'timerKey' is assigned a value but never used
text = text.replace(/const timerKey = room\.roomCode \+ '_' \+ newPlayerId;/g, '// timerKey removed');

// 631:27 'room.roomCode' is assigned to itself
text = text.replace(/room\.roomCode = room\.roomCode;/g, '// self assign removed');

// 1706:15 'blockedBySpiritSkin' is assigned a value but never used
text = text.replace(/let blockedBySpiritSkin = false;/g, '');
text = text.replace(/blockedBySpiritSkin = true;/g, '');

// 1711:15 'damageDealt' is assigned a value but never used
text = text.replace(/let damageDealt = false;/g, '');
text = text.replace(/damageDealt = true;/g, '');

fs.writeFileSync('server/src/index.ts', text);
console.log('Lint errors fixed.');
