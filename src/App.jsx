import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import { Toaster, toast } from 'react-hot-toast';
import './App.css';

const apiKey = "AIzaSyDEP9j9Ec9YhaR7jHcQr5m1ZwVPGY-GOiY";

// --- Вспомогательные функции ---
const initializeChatSession = (history) => {
    try {
        const ai = new GoogleGenerativeAI(apiKey);
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
        return model.startChat({ history });
    } catch (error) {
        console.error("Не удалось инициализировать сессию ИИ:", error);
        toast.error("Ошибка инициализации ИИ. Проверьте API ключ.");
        return null;
    }
};

const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
});

// --- Компоненты ---
const EmptyChatView = () => (
    <div className="empty-chat-container">
        <div className="empty-chat-content">
            <div className="empty-chat-logo">🤖</div>
            <h1>Чем я могу помочь?</h1>
        </div>
    </div>
);

const LoadingSkeleton = () => (
    <div className="message-wrapper model-wrapper">
        <div className="message">
            <div className="message-icon">🤖</div>
            <div className="message-content skeleton">
                <div className="skeleton-line"></div>
                <div className="skeleton-line short"></div>
            </div>
        </div>
    </div>
);

function App() {
    const [chats, setChats] = useState(() => {
        try {
            const savedChats = localStorage.getItem('chat_history');
            if (savedChats) {
                const parsedChats = JSON.parse(savedChats);
                return parsedChats.map(chat => ({
                    ...chat,
                    session: initializeChatSession(chat.history || [])
                }));
            }
        } catch (error) { console.error("Не удалось загрузить чаты:", error); }
        return [];
    });

    const [activeChatId, setActiveChatId] = useState(null);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);
    const [theme, setTheme] = useState('dark');
    const [searchTerm, setSearchTerm] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState('');

    const recognitionRef = useRef(null);
    const messagesEndRef = useRef(null);
    const messageListRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        const chatsToSave = chats.map(({ id, title, history }) => ({ id, title, history }));
        localStorage.setItem('chat_history', JSON.stringify(chatsToSave));
    }, [chats]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chats, activeChatId]);

    useEffect(() => {
        if (!messageListRef.current) return;
        const codeBlocks = messageListRef.current.querySelectorAll('pre code');
        codeBlocks.forEach((block) => {
            hljs.highlightElement(block);
            const pre = block.parentNode;
            if (pre.querySelector('.copy-button')) return;
            const button = document.createElement('button');
            button.className = 'copy-button';
            button.innerText = 'Copy';
            button.onclick = () => {
                navigator.clipboard.writeText(block.innerText);
                button.innerText = 'Copied!';
                toast.success('Код скопирован!');
                setTimeout(() => { button.innerText = 'Copy'; }, 2000);
            };
            pre.appendChild(button);
        });
    }, [chats, activeChatId]);

    useEffect(() => {
        document.body.className = theme;
    }, [theme]);

    const createNewChat = () => {
        const newChatSession = initializeChatSession([]);
        if (!newChatSession) return;
        const newChat = { id: Date.now(), title: 'Новый чат', history: [], session: newChatSession };
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(newChat.id);
        if (!isSidebarVisible) setIsSidebarVisible(true);
    };

    const deleteChat = (e, chatIdToDelete) => {
        e.stopPropagation();
        setChats(prev => prev.filter(chat => chat.id !== chatIdToDelete));
        if (activeChatId === chatIdToDelete) setActiveChatId(null);
    };

    const handleSelectChat = (chatId) => setActiveChatId(chatId);
    const toggleSidebar = () => setIsSidebarVisible(!isSidebarVisible);
    const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const removeImage = () => {
        setImageFile(null);
        setImagePreview('');
        if (fileInputRef.current) fileInputRef.current.value = null;
    };

    const handleVoiceInput = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            return;
        }
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            toast.error("Ваш браузер не поддерживает голосовой ввод.");
            return;
        }
        const recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.interimResults = true;
        recognitionRef.current = recognition;
        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event) => {
            console.error("Ошибка распознавания:", event.error);
            setIsListening(false);
        };
        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                 setUserInput(prev => prev + finalTranscript);
            }
        };
        recognition.start();
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if ((!userInput.trim() && !imageFile) || isLoading) return;

        let currentChat;
        let currentChatId = activeChatId;

        if (!currentChatId) {
            const newChatSession = initializeChatSession([]);
            if (!newChatSession) return;
            currentChat = { id: Date.now(), title: 'Новый чат', history: [], session: newChatSession };
            currentChatId = currentChat.id;
            setChats(prev => [currentChat, ...prev]);
            setActiveChatId(currentChatId);
        } else {
            currentChat = chats.find(c => c.id === currentChatId);
        }

        if (!currentChat || !currentChat.session) {
            toast.error("Ошибка сессии. Попробуйте создать новый чат.");
            return;
        }
        
        setIsLoading(true);

        const userMessageParts = [];
        if (imageFile) userMessageParts.push({ image: imagePreview });
        if (userInput.trim()) userMessageParts.push({ text: userInput });

        const contentsForAI = [];
        if (imageFile) {
            const base64Data = await fileToBase64(imageFile);
            contentsForAI.push({ inlineData: { mimeType: imageFile.type, data: base64Data } });
        }
        if (userInput.trim()) {
            contentsForAI.push({ text: userInput });
        }

        const newTitle = currentChat.title === 'Новый чат' && userInput.trim() ? userInput.substring(0, 30) + '...' : currentChat.title;
        const historyWithUserMessage = [...currentChat.history, { role: 'user', parts: userMessageParts }];
        
        setChats(prev => prev.map(chat =>
            chat.id === currentChatId ? { ...chat, history: historyWithUserMessage, title: newTitle } : chat
        ));
        
        setUserInput('');
        removeImage();
        
        try {
            const result = await currentChat.session.sendMessageStream(contentsForAI);
            let modelResponse = '';
            const modelMessagePlaceholder = { role: 'model', parts: [{ text: '' }] };
            const historyWithPlaceholder = [...historyWithUserMessage, modelMessagePlaceholder];
            setChats(prev => prev.map(chat => chat.id === currentChatId ? {...chat, history: historyWithPlaceholder} : chat));

            for await (const chunk of result.stream) {
                modelResponse += chunk.text();
                setChats(prev => prev.map(chat => {
                    if (chat.id === currentChatId) {
                        const newHistory = [...chat.history];
                        newHistory[newHistory.length - 1].parts[0].text = modelResponse;
                        return { ...chat, history: newHistory };
                    }
                    return chat;
                }));
            }
        } catch (error) {
            console.error("Ошибка отправки сообщения:", error);
            toast.error("Произошла ошибка при отправке сообщения.");
            const errorHistory = [...historyWithUserMessage, { role: 'model', parts: [{ text: "Извините, произошла ошибка." }] }];
            setChats(prev => prev.map(chat => chat.id === currentChatId ? {...chat, history: errorHistory} : chat));
        } finally {
            setIsLoading(false);
        }
    };

    const filteredChats = chats.filter(chat =>
        chat.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const activeChat = chats.find(chat => chat.id === activeChatId);
    
    return (
        <div className="app-container">
            <Toaster position="top-right" toastOptions={{className: 'toast-notification'}}/>
            {isSidebarVisible && (
                <div className="sidebar">
                    <button onClick={createNewChat} className="new-chat-button">+ Новый чат</button>
                    <div className="sidebar-header">
                        <input
                            type="search"
                            placeholder="Поиск..."
                            className="search-input"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="chat-list">
                        {filteredChats.map(chat => (
                            <div key={chat.id} className={`chat-list-item ${chat.id === activeChatId ? 'active' : ''}`} onClick={() => handleSelectChat(chat.id)}>
                                <span className="chat-list-item-title">{chat.title}</span>
                                <button onClick={(e) => deleteChat(e, chat.id)} className="delete-chat-button">🗑️</button>
                            </div>
                        ))}
                    </div>
                    <div className="sidebar-footer">
                        <button onClick={toggleTheme} className="control-button">
                            {theme === 'dark' ? '☀️' : '🌙'} Сменить тему
                        </button>
                        <button onClick={toggleSidebar} className="control-button">
                            ◧ Скрыть
                        </button>
                    </div>
                </div>
            )}
            {!isSidebarVisible && (
                <button
                    onClick={toggleSidebar}
                    className="show-sidebar-button"
                    style={{
                        position: 'absolute',
                        left: 20,
                        bottom: 10,
                        zIndex: 1000
                    }}
                >
                    ◨ Показать
                </button>
            )}

            <main className="chat-area">
                <div className="chat-content-wrapper">
                    <div className="message-list" ref={messageListRef}>
                        {activeChat ? (
                            activeChat.history.length > 0 ? (
                                <>
                                    {activeChat.history.map((msg, index) => (
                                        <div key={`${activeChat.id}-${index}`} className={`message-wrapper ${msg.role}-wrapper`}>
                                            <div className="message">
                                                <div className="message-icon">{msg.role === 'user' ? '👤' : '🤖'}</div>
                                                <div className="message-content">
                                                    {msg.parts.map((part, partIndex) => {
                                                        if (part.text) return <div key={partIndex} dangerouslySetInnerHTML={{ __html: marked.parse(part.text) }} />;
                                                        if (part.image) return <img key={partIndex} src={part.image} alt="user upload" className="message-image" />;
                                                        return null;
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </>
                            ) : (<EmptyChatView />)
                        ) : (<EmptyChatView />)}
                        {isLoading && <LoadingSkeleton />}
                        <div ref={messagesEndRef} />
                    </div>
                    <div className="message-form-container">
                        <div className="message-form-wrapper">
                            {imagePreview && (
                                <div className="image-preview">
                                    <img src={imagePreview} alt="preview" />
                                    <button onClick={removeImage} className="remove-image-button">×</button>
                                </div>
                            )}
                            <form onSubmit={handleSendMessage} className="message-form">
                                <button type="button" onClick={() => fileInputRef.current.click()} className="control-button attachment-button" disabled={isLoading}>📎</button>
                                <input type="file" ref={fileInputRef} onChange={handleImageChange} style={{ display: 'none' }} accept="image/*" />
                                <textarea
                                    value={userInput}
                                    onChange={(e) => setUserInput(e.target.value)}
                                    placeholder="Спросите что-нибудь..."
                                    disabled={isLoading}
                                    rows="1"
                                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
                                />
                                <button type="button" onClick={handleVoiceInput} className={`control-button voice-button ${isListening ? 'listening' : ''}`}>🎤</button>
                                <button type="submit" className="send-button" disabled={(!userInput.trim() && !imageFile) || isLoading}>
                                    {isLoading ? <div className="loading-spinner"></div> : '➤'}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;