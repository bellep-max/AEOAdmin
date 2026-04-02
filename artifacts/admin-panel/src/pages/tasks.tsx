import { useState } from "react";
import { useGetTasks, useUpdateTask } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";

export default function Tasks() {
  const { data: tasks, isLoading } = useGetTasks();
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();

  const handleMoveTask = (taskId: number, newStatus: 'todo' | 'in_progress' | 'done') => {
    updateTask.mutate(
      { id: taskId, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
        }
      }
    );
  };

  const getPriorityColor = (priority: string) => {
    switch(priority) {
      case 'high': return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'medium': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'low': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const columns = [
    { id: 'todo', title: 'To Do', items: tasks?.filter(t => t.status === 'todo') || [] },
    { id: 'in_progress', title: 'In Progress', items: tasks?.filter(t => t.status === 'in_progress') || [] },
    { id: 'done', title: 'Done', items: tasks?.filter(t => t.status === 'done') || [] }
  ];

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Operations Kanban</h1>
          <p className="text-muted-foreground">Manage administrative and scaling tasks.</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Add Task
        </Button>
      </div>

      <div className="flex-1 grid md:grid-cols-3 gap-6 overflow-hidden">
        {columns.map(col => (
          <div key={col.id} className="flex flex-col h-full bg-card/30 border rounded-xl overflow-hidden">
            <div className="p-4 border-b bg-card/50 flex items-center justify-between shrink-0">
              <h2 className="font-semibold">{col.title}</h2>
              <Badge variant="secondary">{col.items.length}</Badge>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="bg-card">
                    <CardHeader className="p-4"><Skeleton className="h-5 w-3/4" /></CardHeader>
                    <CardContent className="p-4 pt-0"><Skeleton className="h-16 w-full" /></CardContent>
                  </Card>
                ))
              ) : col.items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed border-border/50 rounded-lg">
                  Drop tasks here
                </div>
              ) : (
                col.items.map(task => (
                  <Card key={task.id} className="bg-card hover:border-primary/50 transition-colors group cursor-pointer relative">
                    <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between space-y-0">
                      <div className="space-y-1 pr-4">
                        <CardTitle className="text-base font-medium leading-tight">{task.title}</CardTitle>
                        {task.category && (
                          <span className="text-xs text-muted-foreground">{task.category}</span>
                        )}
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="flex justify-between items-end mt-2">
                        <Badge variant="outline" className={`text-[10px] uppercase px-2 py-0 h-5 ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </Badge>
                        
                        <div className="flex gap-1">
                          {columns.filter(c => c.id !== task.status).map(c => (
                            <Button 
                              key={c.id} 
                              variant="outline" 
                              size="sm" 
                              className="h-6 text-[10px] px-2"
                              onClick={() => handleMoveTask(task.id, c.id as any)}
                            >
                              Move to {c.title}
                            </Button>
                          ))}
                        </div>
                      </div>
                      
                      {task.subtasks && task.subtasks.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                          {task.subtasks.map(sub => (
                            <div key={sub.id} className="flex items-center space-x-2">
                              <Checkbox id={`sub-${sub.id}`} checked={sub.done} className="w-4 h-4" />
                              <label
                                htmlFor={`sub-${sub.id}`}
                                className={`text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${sub.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                              >
                                {sub.title}
                              </label>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
