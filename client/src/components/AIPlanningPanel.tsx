import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { Bot, Sparkles, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

export function AIPlanningPanel({ selectedDate }: { selectedDate: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aiPlan, setAiPlan] = useState<any>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');
  
  const planDayMutation = useMutation({
    mutationFn: async (date: string) => {
      const response = await apiRequest('POST', '/api/ai/plan-day', { date });
      return response.json();
    },
    onSuccess: (data) => {
      setAiPlan(data);
      // Show debug info for what OpenAI returned
      setDebugInfo(JSON.stringify(data, null, 2));
      toast({
        title: "AI Schedule Generated",
        description: `Created optimal schedule with ${data.suggestions?.length || 0} task suggestions`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
    },
    onError: () => {
      toast({
        title: "Planning Failed",
        description: "Could not generate AI schedule. Please try again.",
        variant: "destructive"
      });
    }
  });

  const acceptSuggestion = async (suggestion: any) => {
    try {
      // Create a focus block from the AI suggestion
      await apiRequest('POST', '/api/focus-blocks', {
        taskId: suggestion.taskId,
        start: suggestion.start,
        end: suggestion.end,
        confirmed: true
      });
      
      toast({
        title: "Task Scheduled",
        description: `${suggestion.taskTitle} has been added to your calendar`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      
      // Remove accepted suggestion from the list
      setAiPlan((prev: any) => ({
        ...prev,
        suggestions: prev.suggestions.filter((s: any) => s.taskId !== suggestion.taskId)
      }));
    } catch (error) {
      toast({
        title: "Scheduling Failed",
        description: "Could not schedule the task. Please try again.",
        variant: "destructive"
      });
    }
  };

  const dismissSuggestion = (suggestionId: string) => {
    setAiPlan((prev: any) => ({
      ...prev,
      suggestions: prev.suggestions.filter((s: any) => s.taskId !== suggestionId)
    }));
    toast({
      title: "Suggestion Dismissed",
      description: "You can regenerate the schedule anytime",
    });
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-600" />
          AI Day Planner
        </CardTitle>
        <CardDescription>
          Let AI optimize your schedule based on priorities and deadlines
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto">
        <div className="space-y-4">
          <Button
            onClick={() => planDayMutation.mutate(selectedDate)}
            disabled={planDayMutation.isPending}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            data-testid="button-ai-plan-day"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {planDayMutation.isPending ? "Generating..." : "Generate Optimal Schedule"}
          </Button>

          {aiPlan && (
            <>
              {/* AI Suggestions */}
              {aiPlan.suggestions?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-gray-700">Suggested Schedule</h3>
                  {aiPlan.suggestions.map((suggestion: any) => (
                    <Card key={suggestion.taskId} className="border-purple-200 bg-purple-50">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="font-medium text-sm">{suggestion.taskTitle}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <Clock className="h-3 w-3 text-gray-500" />
                              <span className="text-xs text-gray-600">
                                {format(new Date(suggestion.start), 'h:mm a')} - 
                                {format(new Date(suggestion.end), 'h:mm a')}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {suggestion.estimatedMinutes} mins
                              </Badge>
                            </div>
                            {suggestion.reasoning && (
                              <p className="text-xs text-gray-600 mt-2 italic">
                                💡 {suggestion.reasoning}
                              </p>
                            )}
                          </div>
                          <Badge className="bg-purple-600 text-white">AI</Badge>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            onClick={() => acceptSuggestion(suggestion)}
                            className="flex-1"
                            data-testid={`button-accept-${suggestion.taskId}`}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => dismissSuggestion(suggestion.taskId)}
                            className="flex-1"
                            data-testid={`button-dismiss-${suggestion.taskId}`}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Unscheduled Tasks */}
              {aiPlan.unscheduledTasks?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-gray-700">Could Not Schedule</h3>
                  {aiPlan.unscheduledTasks.map((task: any) => (
                    <div key={task.taskId} className="p-2 bg-yellow-50 border border-yellow-200 rounded-md">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5" />
                        <div className="flex-1">
                          <div className="text-sm font-medium">{task.taskTitle}</div>
                          <div className="text-xs text-gray-600">{task.reason}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {aiPlan.recommendations?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm text-gray-700">AI Recommendations</h3>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <ul className="space-y-1">
                      {aiPlan.recommendations.map((rec: string, idx: number) => (
                        <li key={idx} className="text-xs text-gray-700 flex items-start">
                          <span className="mr-2">•</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}

          {!aiPlan && !planDayMutation.isPending && (
            <div className="text-center py-8 text-gray-500">
              <Bot className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">Click the button above to let AI optimize your day</p>
              <p className="text-xs mt-2">AI will schedule tasks between 9 AM - 5 PM business hours</p>
            </div>
          )}

          {/* Debug Info Section */}
          {debugInfo && (
            <div className="mt-4 p-3 bg-gray-100 rounded-md">
              <h4 className="font-semibold text-xs text-gray-700 mb-2">OpenAI Response (Debug):</h4>
              <pre className="text-xs text-gray-600 overflow-auto max-h-32 whitespace-pre-wrap">
                {debugInfo}
              </pre>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDebugInfo('')}
                className="mt-2 text-xs"
              >
                Hide Debug Info
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}