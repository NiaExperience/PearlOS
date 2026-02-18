import { z } from 'zod';

// Local types for assistant-content registration section

// export interface ExcursionFormData {
//   assistant_id: string;
//   excursion_name: string;
//   duration_hours: number;
//   price: number;
//   description: string;
//   location: string;
//   available_slots: number;
//   photo_url: string;
//   is_active: boolean;
//   category: string;
//   client_code: string;
// }

export interface Registration {
  _id?: string;
  assistant_id: string;
  registrationUrl: string;
  isActive: boolean;
  // Add other fields as needed
}

export const RegistrationSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  registrationUrl: z.string().url(),
  isActive: z.boolean(),
});

// Add other registration-specific types here as needed 