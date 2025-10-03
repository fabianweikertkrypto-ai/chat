const express = require('express');
const fs = require('fs').promises;
const cors = require('cors');

const app = express();
const PORT = 3001;

// Database files
const MESSAGES_FILE = 'messages.json';
const CHAT_USERS_FILE = 'chatUsers.json';

const corsOptions = {
    origin: [
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:5500',
        'http://127.0.0.1:5501',
        'https://merry-klepon-890f17.netlify.app',
        'https://msigaminguniverse.com',
        'https://www.msigaminguniverse.com',  // www-Variante hinzugefügt
        'https://chat-71oo.onrender.com'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// ========== HELPER FUNCTIONS ==========

async function readMessages() {
    try {
        const data = await fs.readFile(MESSAGES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        const defaultData = { conversations: {} };
        await writeMessages(defaultData);
        console.log(`${MESSAGES_FILE} created`);
        return defaultData;
    }
}

async function writeMessages(data) {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function readChatUsers() {
    try {
        const data = await fs.readFile(CHAT_USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        const defaultData = { users: {} };
        await writeChatUsers(defaultData);
        console.log(`${CHAT_USERS_FILE} created`);
        return defaultData;
    }
}

async function writeChatUsers(data) {
    await fs.writeFile(CHAT_USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Generate conversation ID (alphabetically sorted wallet addresses)
function getConversationId(wallet1, wallet2) {
    const sorted = [wallet1.toLowerCase(), wallet2.toLowerCase()].sort();
    return `${sorted[0]}_${sorted[1]}`;
}

// ========== API ENDPOINTS ==========

// Get users from same tournaments (connects to main backend)
app.get('/chat/available-users/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        const userWallet = walletAddress.toLowerCase();

        // Fetch data from main backend
        const gamesResponse = await fetch('https://msi-tournament-backend.onrender.com/games');
        if (!gamesResponse.ok) {
            return res.status(500).json({ error: 'Failed to fetch tournament data' });
        }

        const gamesData = await gamesResponse.json();
        const availableUsers = new Map();

        // Find all users in same tournaments
        Object.values(gamesData).forEach(game => {
            if (game.tournaments) {
                Object.values(game.tournaments).forEach(tournament => {
                    const isParticipant = tournament.participants?.some(p => 
                        p.walletAddress.toLowerCase() === userWallet
                    );

                    if (isParticipant && tournament.status !== 'finished') {
                        tournament.participants.forEach(participant => {
                            const pWallet = participant.walletAddress.toLowerCase();
                            if (pWallet !== userWallet && !availableUsers.has(pWallet)) {
                                availableUsers.set(pWallet, {
                                    walletAddress: participant.walletAddress,
                                    platformUsername: participant.platformUsername,
                                    gamertags: participant.gamertags
                                });
                            }
                        });
                    }
                });
            }
        });

        // Get unread message counts
        const messagesData = await readMessages();
        const usersWithUnread = Array.from(availableUsers.values()).map(user => {
            const convId = getConversationId(userWallet, user.walletAddress);
            const conversation = messagesData.conversations[convId];
            
            let unreadCount = 0;
            if (conversation?.messages) {
                unreadCount = conversation.messages.filter(msg => 
                    msg.to.toLowerCase() === userWallet && !msg.read
                ).length;
            }

            return {
                ...user,
                unreadCount
            };
        });

        res.json({
            users: usersWithUnread,
            count: usersWithUnread.length
        });

    } catch (error) {
        console.error('Error fetching available users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get conversation (last 3 messages)
app.get('/chat/conversation/:wallet1/:wallet2', async (req, res) => {
    try {
        const { wallet1, wallet2 } = req.params;
        const conversationId = getConversationId(wallet1, wallet2);
        
        const messagesData = await readMessages();
        const conversation = messagesData.conversations[conversationId];

        if (!conversation) {
            return res.json({
                conversationId,
                messages: [],
                participants: [wallet1.toLowerCase(), wallet2.toLowerCase()]
            });
        }

        // Mark messages as read for the requesting user
        if (conversation.messages) {
            conversation.messages.forEach(msg => {
                if (msg.to.toLowerCase() === wallet1.toLowerCase()) {
                    msg.read = true;
                }
            });
            await writeMessages(messagesData);
        }

        res.json({
            conversationId,
            messages: conversation.messages || [],
            participants: conversation.participants
        });

    } catch (error) {
        console.error('Error fetching conversation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send message
app.post('/chat/send', async (req, res) => {
    try {
        const { from, to, message, messageType } = req.body;

        if (!from || !to || !message) {
            return res.status(400).json({ error: 'From, to, and message are required' });
        }

        const conversationId = getConversationId(from, to);
        const messagesData = await readMessages();

        if (!messagesData.conversations[conversationId]) {
            messagesData.conversations[conversationId] = {
                participants: [from.toLowerCase(), to.toLowerCase()],
                messages: [],
                createdAt: new Date().toISOString()
            };
        }

        const newMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            message,
            messageType: messageType || 'text',
            timestamp: new Date().toISOString(),
            read: false
        };

        // Add message and keep only last 3
        messagesData.conversations[conversationId].messages.push(newMessage);
        if (messagesData.conversations[conversationId].messages.length > 3) {
            messagesData.conversations[conversationId].messages = 
                messagesData.conversations[conversationId].messages.slice(-3);
        }

        messagesData.conversations[conversationId].lastMessageAt = new Date().toISOString();

        await writeMessages(messagesData);

        res.json({
            message: 'Message sent successfully',
            messageData: newMessage
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get unread message count
app.get('/chat/unread/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        const userWallet = walletAddress.toLowerCase();
        
        const messagesData = await readMessages();
        let totalUnread = 0;

        Object.values(messagesData.conversations).forEach(conversation => {
            if (conversation.participants.includes(userWallet)) {
                totalUnread += conversation.messages.filter(msg => 
                    msg.to === userWallet && !msg.read
                ).length;
            }
        });

        res.json({ unreadCount: totalUnread });

    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Server start
app.listen(PORT, async () => {
    console.log(`🚀 Chat Server running on http://localhost:${PORT}`);
    
    // Initialize files
    await readMessages();
    await readChatUsers();
    
    console.log('✅ Chat server initialized');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Chat server shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Chat server shutting down...');
    process.exit(0);
});
