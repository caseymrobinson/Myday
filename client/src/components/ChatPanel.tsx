import { useState, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage } from "../types";
import { X, Bot, Send, Sparkles } from "lucide-react";

interface ChatPanelProps {
  onClose: () => void;
}

export interface ChatPanelHandle {
  addMessage: (message: string, isUser?: boolean) => void;
}

const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(({ onClose }, ref) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      message: "Hi! I'm your AI assistant. I can help you understand your schedule, manage tasks, and plan your day. Try asking \"What's on my agenda today?\" or \"I need to prepare for tomorrow's presentation\"",
      timestamp: new Date(),
      isUser: false
    }
  ]);

  // Function to add messages externally (e.g., from Plan My Day)
  const addMessage = (message: string, isUser: boolean = false) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      message,
      timestamp: new Date(),
      isUser
    };
    setMessages(prev => [...prev, newMessage]);
  };

  // Expose addMessage function to parent via ref
  useImperativeHandle(ref, () => ({
    addMessage
  }));
  const [inputMessage, setInputMessage] = useState("");
  const { toast } = useToast();

  const sendMessageMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: Array<{role: string, content: string}> }) => 
      api.sendMessage(message, history),
    onSuccess: (data, variables) => {
      // Add user message and AI response
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          message: variables.message,
          timestamp: new Date(),
          isUser: true
        },
        {
          id: (Date.now() + 1).toString(),
          message: data.response,
          timestamp: new Date(),
          isUser: false
        }
      ]);
    },
    onError: () => {
      toast({ 
        title: "Failed to send message", 
        variant: "destructive" 
      });
    }
  });

  // Convert messages to conversation history format
  const getConversationHistory = () => {
    return messages.slice(1).map(msg => ({
      role: msg.isUser ? 'user' as const : 'assistant' as const,
      content: msg.message
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    
    const history = getConversationHistory();
    sendMessageMutation.mutate({ message: inputMessage, history });
    setInputMessage("");
  };

  const handleQuickAction = (message: string) => {
    const history = getConversationHistory();
    setInputMessage(message);
    sendMessageMutation.mutate({ message, history });
    setInputMessage("");
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const quickActions = [
    { label: "What's my schedule?", icon: "📅", action: "What's on my agenda today?" },
    { label: "Create task", icon: "✏️", action: "I need to " },
    { label: "Next meeting", icon: "🕐", action: "When is my next meeting?" },
    { label: "Plan my day", icon: "🎯", action: "Help me plan my day" }
  ];

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#5E00E1] to-[#4A00B5] flex items-center justify-center">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-white font-medium">AI Assistant</h2>
            <p className="text-xs text-gray-400">Always here to help</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-gray-400 hover:text-white hover:bg-gray-800"
          data-testid="button-close-chat"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-6 py-4">
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
              data-testid={`chat-message-${msg.id}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.isUser
                    ? 'bg-[#5E00E1] text-white'
                    : 'bg-gray-900 text-gray-200 border border-gray-800'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                <span className={`text-xs mt-1 block ${
                  msg.isUser ? 'text-[#B580FF]' : 'text-gray-500'
                }`}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          ))}
          {sendMessageMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#5E00E1] rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-[#5E00E1] rounded-full animate-bounce delay-100"></div>
                  <div className="w-2 h-2 bg-[#5E00E1] rounded-full animate-bounce delay-200"></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Quick Actions */}
      <div className="px-6 py-3 border-t border-gray-800">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {quickActions.map((action, index) => (
            <Button
              key={index}
              size="sm"
              variant="secondary"
              onClick={() => handleQuickAction(action.action)}
              className="bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-800 whitespace-nowrap flex items-center gap-1"
              data-testid={`quick-action-${index}`}
            >
              <span>{action.icon}</span>
              <span className="text-xs">{action.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-6 pb-6">
        <div className="relative">
          <Input
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask me anything..."
            className="bg-gray-900 border-gray-800 text-white placeholder-gray-500 pr-12 py-6 rounded-xl"
            disabled={sendMessageMutation.isPending}
            data-testid="chat-input"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!inputMessage.trim() || sendMessageMutation.isPending}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#5E00E1] hover:bg-[#4A00B5] text-white rounded-lg h-8 w-8"
            data-testid="button-send-message"
          >
            {sendMessageMutation.isPending ? (
              <Sparkles className="h-4 w-4 animate-pulse" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';
export default ChatPanel;