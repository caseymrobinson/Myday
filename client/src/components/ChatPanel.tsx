import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage } from "../types";
import { X, Bot, Send } from "lucide-react";

interface ChatPanelProps {
  onClose: () => void;
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      message: "Hi! I'm your AI assistant. I can help you understand your schedule, manage tasks, and plan your day. Try asking \"What am I doing today?\"",
      timestamp: new Date(),
      isUser: false
    }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const { toast } = useToast();

  const sendMessageMutation = useMutation({
    mutationFn: api.sendMessage,
    onSuccess: (data, variables) => {
      // Add user message and AI response
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          message: variables,
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    
    sendMessageMutation.mutate(inputMessage);
    setInputMessage("");
  };

  const handleQuickAction = (message: string) => {
    setInputMessage(message);
    sendMessageMutation.mutate(message);
    setInputMessage("");
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Bot className="h-5 w-5 text-amber-500 mr-2" />
            AI Assistant
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-close-chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Ask me about your schedule, tasks, or anything else!
        </p>
      </div>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.isUser ? 'justify-end' : 'items-start space-x-2'}`}
            data-testid={`chat-message-${message.id}`}
          >
            {!message.isUser && (
              <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="h-3 w-3 text-white" />
              </div>
            )}
            
            <Card className={`max-w-xs ${message.isUser ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
              <CardContent className="p-3">
                <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                <div className={`text-xs mt-1 ${message.isUser ? 'text-blue-100' : 'text-gray-500'}`}>
                  {formatTime(message.timestamp)}
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
        
        {sendMessageMutation.isPending && (
          <div className="flex items-start space-x-2">
            <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
              <Bot className="h-3 w-3 text-white" />
            </div>
            <Card className="bg-gray-100">
              <CardContent className="p-3">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
      
      {/* Input */}
      <div className="p-4 border-t border-gray-200">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <Input
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask me anything about your day..."
            disabled={sendMessageMutation.isPending}
            data-testid="input-chat-message"
          />
          <Button 
            type="submit" 
            disabled={sendMessageMutation.isPending || !inputMessage.trim()}
            className="bg-blue-600 text-white hover:bg-blue-700"
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
        
        {/* Quick Action Buttons */}
        <div className="flex flex-wrap gap-1 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickAction("What's my next meeting?")}
            disabled={sendMessageMutation.isPending}
            className="text-xs"
            data-testid="button-quick-next-meeting"
          >
            Next meeting?
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickAction("Show me my free time")}
            disabled={sendMessageMutation.isPending}
            className="text-xs"
            data-testid="button-quick-free-time"
          >
            Free time?
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickAction("What should I prioritize?")}
            disabled={sendMessageMutation.isPending}
            className="text-xs"
            data-testid="button-quick-priorities"
          >
            Priorities?
          </Button>
        </div>
      </div>
    </div>
  );
}
