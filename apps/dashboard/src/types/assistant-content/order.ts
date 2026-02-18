// Local types for assistant-content order section

export interface Order {
  _id?: string;
  assistant_id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  orderTotal: number;
  orderDate?: string;
  contactInfo?: {
    guestName?: string;
    roomNumber?: string;
  };
  spaServiceOrder?: {
    duration: number;
    serviceName: string;
    serviceTime: string;
  };
  shoreExcursionOrder?: {
    excursionName: string;
    excursionTime: string;
    numberOfGuests: number;
    pricePerPerson: number;
  };
  roomServiceOrder?: {
    estimatedDelivery: string;
    orderItems: string[];
  };
  // Add other fields as needed
} 