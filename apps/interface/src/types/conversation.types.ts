/* eslint-disable @typescript-eslint/no-explicit-any */
export enum MessageTypeEnum {
  TRANSCRIPT = 'transcript',
  FUNCTION_CALL = 'function-call',
  FUNCTION_CALL_RESULT = 'function-call-result',
  ADD_MESSAGE = 'add-message',
  MODEL_OUTPUT = 'model-output',
  TOOL_CALLS = 'tool-calls',
}

export enum MessageRoleEnum {
  USER = 'user',
  SYSTEM = 'system',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}

export enum TranscriptMessageTypeEnum {
  PARTIAL = 'partial',
  FINAL = 'final',
}

export interface TranscriptMessage extends BaseMessage {
  type: MessageTypeEnum.TRANSCRIPT;
  role: MessageRoleEnum;
  transcriptType: TranscriptMessageTypeEnum;
  transcript: string;
}

export interface FunctionCallResultMessage extends BaseMessage {
  type: MessageTypeEnum.FUNCTION_CALL_RESULT;
  functionCallResult: {
    forwardToClientEnabled?: boolean;
    result: any;
    [a: string]: any;
  };
  transcript?: string;
}

export interface FunctionCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: any;
  };
}

export interface FunctionCallMessage extends BaseMessage {
  type: MessageTypeEnum.FUNCTION_CALL;
  function: {
    name: string;
    arguments: any;
  };
}

export interface ToolCallsMessage extends BaseMessage {
  type: MessageTypeEnum.TOOL_CALLS;
  toolCalls: FunctionCall[];
}

export interface ModelOutputMessage extends BaseMessage {
  type: MessageTypeEnum.MODEL_OUTPUT;
  output: string | FunctionCall[];
}

export interface BaseMessage {
  type: MessageTypeEnum;
}

export type Message =
  | TranscriptMessage
  | FunctionCallMessage
  | FunctionCallResultMessage
  | ToolCallsMessage
  | ModelOutputMessage;
