type RoomServiceItem = {
  item_name: string;
  quantity: number;
  price: number;
  special_notes: string;
};

type RoomServiceOrder = {
  order_id: string;
  items: RoomServiceItem[];
  order_time: string;
  status: string;
};

type Reservation = {
  reservation_id: string;
  type: string;
  location: string;
  time: string;
  special_requests: string;
};

type Upgrade = {
  upgrade_id: string;
  type: string;
  from: string;
  to: string;
  date: string;
  status: string;
};

type Photo = {
  photo_id: string;
  url: string;
  description: string;
};

export type Customer = {
  customer_id: string;
  name: string;
  phone_number: string;
  email: string;
  room_number: string;
  room_service_orders: RoomServiceOrder[];
  reservations: Reservation[];
  upgrades: Upgrade[];
  current_location: string;
  social_interests: string[];
  photos_shared: Photo[];
  hospitality_recommendations: string[];
  food_allergies: string[];
  notes: string;
};

export interface Attendee {
  name: string;
  role: string;
  image_url: string;
}
