import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { Toaster, toast } from 'react-hot-toast';
import './App.css';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

const initializeChatSession = (history, systemInstruction) => {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: systemInstruction,
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
        });
        return model.startChat({ history });
    } catch (error) {
        console.error("Не удалось инициализировать сессию ИИ:", error);
        toast.error("Ошибка инициализации ИИ. Убедитесь, что API ключ указан верно в файле .env");
        return null;
    }
};

const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
});

const EmptyChatView = () => (
    <div className="empty-chat-container">
        <div className="empty-chat-content">
            <div className="gemini-logo"></div>
            <h1>Чем я могу помочь?</h1>
        </div>
    </div>
);

const LoadingSkeleton = () => (
    <div className="message-wrapper model-wrapper">
        <div className="message">
            <div className="message-icon">✨</div>
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
                return parsedChats.map(chat => ({ ...chat, session: initializeChatSession(chat.history || [], chat.systemInstruction || '') }));
            }
        } catch (error) { console.error("Не удалось загрузить чаты:", error); }
        return [];
    });

    const [activeChatId, setActiveChatId] = useState(null);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [theme, setTheme] = useState('dark');
    const [searchTerm, setSearchTerm] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState('');
    const [editingMessage, setEditingMessage] = useState(null);

    const recognitionRef = useRef(null);
    const messagesEndRef = useRef(null);
    const messageListRef = useRef(null);
    const fileInputRef = useRef(null);
    const abortControllerRef = useRef(null);

    useEffect(() => {
        if (window.innerWidth <= 768) {
            setIsSidebarOpen(false);
        }
    }, []);

    useEffect(() => {
        const chatsToSave = chats.map(({ id, title, history, systemInstruction }) => ({ id, title, history, systemInstruction }));
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
            button.innerHTML = '<span class="icon-copy"></span>';
            button.onclick = () => {
                navigator.clipboard.writeText(block.innerText);
                toast.success('Код скопирован!');
            };
            pre.appendChild(button);
        });
    }, [chats, activeChatId, isLoading]);

    useEffect(() => {
        document.body.className = theme;
    }, [theme]);

    const createNewChat = () => {
        const newChat = { 
            id: Date.now(), 
            title: 'Новый чат', 
            history: [], 
            session: initializeChatSession([], ''),
            systemInstruction: '' 
        };
        if (!newChat.session) return;
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(newChat.id);
        if (window.innerWidth <= 768) {
            setIsSidebarOpen(false);
        }
    };

    const deleteChat = (e, chatIdToDelete) => {
        e.stopPropagation();
        setChats(prev => prev.filter(chat => chat.id !== chatIdToDelete));
        if (activeChatId === chatIdToDelete) setActiveChatId(null);
    };

    const handleSelectChat = (chatId) => {
        setActiveChatId(chatId);
        if (window.innerWidth <= 768) {
            setIsSidebarOpen(false);
        }
    };

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
    const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

    const handleSystemInstructionChange = (e, chatId) => {
        const newInstruction = e.target.value;
        setChats(prevChats => prevChats.map(chat => {
            if (chat.id === chatId) {
                const updatedSession = initializeChatSession(chat.history, newInstruction);
                return { ...chat, systemInstruction: newInstruction, session: updatedSession };
            }
            return chat;
        }));
    };

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

    const handleSendMessage = async (e, { overrideText = null, overrideHistory = null } = {}) => {
        e.preventDefault();
        const textToSend = overrideText ?? userInput;
        if ((!textToSend.trim() && !imageFile) || isLoading) return;

        abortControllerRef.current = new AbortController();

        let currentChat;
        let currentChatId = activeChatId;
        let isNewChat = !currentChatId;

        if (isNewChat) {
            currentChat = { 
                id: Date.now(), 
                title: 'Новый чат', 
                history: [], 
                session: null, 
                systemInstruction: '' 
            };
            currentChatId = currentChat.id;
            currentChat.session = initializeChatSession([], currentChat.systemInstruction);
            if (!currentChat.session) return;
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
        if (textToSend.trim()) userMessageParts.push({ text: textToSend });

        const contentsForAI = [];
        if (imageFile) {
            const base64Data = await fileToBase64(imageFile);
            contentsForAI.push({ inlineData: { mimeType: imageFile.type, data: base64Data } });
        }
        if (textToSend.trim()) {
            contentsForAI.push({ text: textToSend });
        }
        
        const historyForUpdate = overrideHistory ?? currentChat.history;
        const historyWithUserMessage = [...historyForUpdate, { role: 'user', parts: userMessageParts }];
        
        setChats(prev => prev.map(chat =>
            chat.id === currentChatId ? { ...chat, history: historyWithUserMessage } : chat
        ));
        
        const userInputForTitle = textToSend;
        setUserInput('');
        removeImage();
        
        try {
            const result = await currentChat.session.sendMessageStream(contentsForAI, { signal: abortControllerRef.current.signal });
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

            if (isNewChat || (overrideHistory && overrideHistory.length === 0)) {
                try {
                    const titleGenModel = initializeChatSession([], "You are an expert at creating short, descriptive titles.");
                    const titlePrompt = `Generate a very short, concise title (3-5 words) for the following conversation:\n\nUser: "${userInputForTitle}"\n\nModel: "${modelResponse}"`;
                    const titleResult = await titleGenModel.sendMessage(titlePrompt);
                    const newTitle = titleResult.response.text().replace(/"/g, '').trim();

                    setChats(prev => prev.map(chat =>
                        chat.id === currentChatId ? { ...chat, title: newTitle } : chat
                    ));
                } catch (titleError) {
                    console.error("Не удалось сгенерировать заголовок:", titleError);
                }
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                toast.success('Генерация отменена');
                 setChats(prev => prev.map(chat =>
                    chat.id === currentChatId ? { ...chat, history: historyWithUserMessage } : chat
                ));
            } else {
                console.error("Ошибка отправки сообщения:", error);
                toast.error("Произошла ошибка при отправке сообщения.");
                const errorHistory = [...historyWithUserMessage, { role: 'model', parts: [{ text: "Извините, произошла ошибка." }] }];
                setChats(prev => prev.map(chat => chat.id === currentChatId ? {...chat, history: errorHistory} : chat));
            }
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleCancelGeneration = () => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
    };

    const startEditing = (chatId, msgIndex, text) => {
        setEditingMessage({ chatId, msgIndex, text });
    };
    const cancelEditing = () => setEditingMessage(null);

    const handleSaveEdit = async () => {
        if (!editingMessage) return;
        const { chatId, msgIndex, text } = editingMessage;
        
        const targetChat = chats.find(c => c.id === chatId);
        const truncatedHistory = targetChat.history.slice(0, msgIndex);

        const fakeEvent = { preventDefault: () => {} };
        await handleSendMessage(fakeEvent, { overrideText: text, overrideHistory: truncatedHistory });
        
        setEditingMessage(null);
    };

    const handleExportChat = () => {
        if (!activeChat) {
            toast.error("Выберите чат для экспорта.");
            return;
        }
        let formattedChat = `Заголовок: ${activeChat.title}\n`;
        if (activeChat.systemInstruction) {
            formattedChat += `Системная инструкция: ${activeChat.systemInstruction}\n`;
        }
        formattedChat += "----------------------------------------\n\n";

        activeChat.history.forEach(msg => {
            const author = msg.role === 'user' ? 'Пользователь' : 'Gemini';
            const textPart = msg.parts.find(p => p.text)?.text || '[Изображение]';
            formattedChat += `[${author}]:\n${textPart}\n\n`;
        });

        const blob = new Blob([formattedChat], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${activeChat.title.replace(/ /g, '_')}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("Чат экспортирован!");
    };
    
    const filteredChats = chats.filter(chat => chat.title.toLowerCase().includes(searchTerm.toLowerCase()));
    const activeChat = chats.find(chat => chat.id === activeChatId);
    
    return (
        <div className="app-container">
            <Toaster position="top-right" toastOptions={{className: 'toast-notification'}}/>
            
            {!isSidebarOpen && (
                <>
                    <button onClick={toggleSidebar} className="show-sidebar-button desktop-only" title="Показать панель"><span className="icon-menu"></span></button>
                    <button onClick={toggleSidebar} className="mobile-sidebar-toggle"><span className="icon-menu"></span></button>
                </>
            )}

            {isSidebarOpen && <div className="overlay mobile-only" onClick={toggleSidebar}></div>}

            <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
                <button onClick={createNewChat} className="new-chat-button">
                    <span className="icon-plus"></span>
                    Новый чат
                </button>
                <div className="sidebar-header">
                    <input
                        type="search"
                        placeholder="Поиск чатов..."
                        className="search-input"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="chat-list">
                    {filteredChats.map(chat => (
                        <div key={chat.id} className={`chat-list-item ${chat.id === activeChatId ? 'active' : ''}`} onClick={() => handleSelectChat(chat.id)}>
                            <span className="chat-list-item-title">{chat.title}</span>
                            <button onClick={(e) => deleteChat(e, chat.id)} className="delete-chat-button">
                                <span className="icon-trash"></span>
                            </button>
                        </div>
                    ))}
                </div>
                <div className="sidebar-footer">
                    <button onClick={handleExportChat} className="control-button">
                        <span className="icon-export"></span>
                        Экспорт чата
                    </button>
                    <button onClick={toggleTheme} className="control-button">
                        {theme === 'dark' ? '☀️' : '🌙'} Сменить тему
                    </button>
                    <button onClick={toggleSidebar} className="control-button desktop-only">
                        <span className="icon-sidebar-hide"></span>
                        Скрыть панель
                    </button>
                </div>
            </aside>
            
            <main className={`chat-area ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
                <div className="chat-content-wrapper">
                    <div className="message-list" ref={messageListRef}>
                        {activeChat && activeChat.history.length > 0 ? (
                            activeChat.history.map((msg, index) => (
                                <div key={`${activeChatId}-${index}`} className={`message-wrapper ${msg.role === 'user' ? 'user-wrapper' : 'model-wrapper'}`}>
                                    <div className="message">
                                        <div className="message-icon">{msg.role === 'user' ? '🙂' : '✨'}</div>
                                        <div className="message-content">
                                            {editingMessage && editingMessage.chatId === activeChat.id && editingMessage.msgIndex === index ? (
                                                <div className="edit-container">
                                                    <textarea 
                                                        value={editingMessage.text}
                                                        onChange={(e) => setEditingMessage({...editingMessage, text: e.target.value})}
                                                        className="edit-textarea"
                                                        rows="4"
                                                    />
                                                    <div className="edit-controls">
                                                        <button onClick={handleSaveEdit} className="save-button">Сохранить и отправить</button>
                                                        <button onClick={cancelEditing} className="cancel-button">Отмена</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    {msg.parts.map((part, partIndex) => {
                                                        if (part.text) return <div key={partIndex} dangerouslySetInnerHTML={{ __html: marked.parse(part.text) }} />;
                                                        if (part.image) return <img key={partIndex} src={part.image} alt="user upload" className="message-image" />;
                                                        return null;
                                                    })}
                                                    {msg.role === 'user' && !isLoading && (
                                                        <button 
                                                            className="edit-button" 
                                                            title="Редактировать"
                                                            onClick={() => startEditing(activeChat.id, index, msg.parts.find(p => p.text)?.text || '')}>
                                                            ✏️
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (<EmptyChatView />)}
                        {isLoading && <LoadingSkeleton />}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="chat-controls">
                        {isLoading && (
                            <button onClick={handleCancelGeneration} className="cancel-generation-button">
                                <span className="icon-stop"></span>
                                Остановить генерацию
                            </button>
                        )}
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
                                <button type="button" onClick={() => fileInputRef.current.click()} className="control-button-input" title="Прикрепить изображение" disabled={isLoading}>
                                    <span className="icon-attach"></span>
                                </button>
                                <input type="file" ref={fileInputRef} onChange={handleImageChange} style={{ display: 'none' }} accept="image/*" />
                                <textarea
                                    value={userInput}
                                    onChange={(e) => setUserInput(e.target.value)}
                                    placeholder="Спросите что-нибудь у Gemini..."
                                    disabled={isLoading}
                                    rows="1"
                                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
                                />
                                <button type="button" onClick={handleVoiceInput} className={`control-button-input ${isListening ? 'listening' : ''}`} title="Голосовой ввод">
                                    <span className="icon-mic"></span>
                                </button>
                                <button type="submit" className="send-button" title="Отправить" disabled={(!userInput.trim() && !imageFile) || isLoading}>
                                    {isLoading ? <div className="loading-spinner"></div> : <span className="icon-send"></span>}
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