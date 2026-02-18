import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: AssistantFeedback
export const AssistantFeedbackDefinition: IDynamicContent = {
    access: {},
    dataModel: {
        block: 'AssistantFeedback',
        indexer: [
            'assistant_id',
            'call_id',
            'feedback_type',
            'status',
            'severity',
            'reported_by'
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                assistant_id: { type: 'string' },
                call_id: { type: 'string' },
                feedback_type: {
                    type: 'string',
                    enum: [
                        'mistake',
                        'improvement',
                        'bug',
                        'other'
                    ]
                },
                description: { type: 'string' },
                conversation_context: { type: 'string' },
                reported_by: { type: 'string' },
                reported_at: { format: 'date-time', type: 'string' },
                status: {
                    type: 'string',
                    enum: [
                        'new',
                        'under_review',
                        'resolved',
                        'wont_fix'
                    ]
                },
                resolution_notes: { type: 'string' },
                severity: {
                    type: 'string',
                    enum: [
                        'low',
                        'medium',
                        'high',
                        'critical'
                    ]
                }
            },
            required: [
                'assistant_id',
                'call_id',
                'feedback_type',
                'description'
            ],
            type: 'object'
        },
        parent: {
            field: 'assistant_id',
            type: 'field'
        }
    },
    description: 'Dynamic Assistant Feedback content type',
    name: 'AssistantFeedback',
    uiConfig: {
        card: {
            descriptionField: 'description',
            tagField: 'feedback_type',
            titleField: 'assistant_id'
        },
        detailView: {
            displayFields: [
                'call_id',
                'feedback_type',
                'description',
                'status',
                'severity',
                'reported_by',
                'reported_at',
                'resolution_notes',
                'conversation_context'
            ]
        },
        listView: {
            displayFields: [
                'feedback_type',
                'status',
                'severity',
                'reported_by',
                'reported_at'
            ]
        }
    }
}