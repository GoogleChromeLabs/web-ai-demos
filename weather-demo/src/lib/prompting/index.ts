
export default class BuiltinPrompting {
    constructor(private session: any) {}


    streamingPrompt(prompt: string): any {
        // Prompt the model and stream the result:
        const stream = this.session.promptStreaming(prompt);
        const reader = stream.getReader();
        return reader;
    }
    
    async prompt(prompt: string): Promise<string> {
        return await this.session.execute(prompt);        
    }

    static async createPrompting(): Promise<BuiltinPrompting> {
        if (window.ai && await window.ai.canCreateTextSession() === 'readily') {
            let builtInsession = await window.ai.createTextSession();
            return new BuiltinPrompting(builtInsession);
        } else {
            throw new Error("Built-in prompting not supported");
        }
    }
}