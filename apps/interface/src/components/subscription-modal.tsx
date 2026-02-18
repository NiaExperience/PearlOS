'use client';

import { X, Check } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@interface/components/ui/card';
import '../features/Notes/styles/notes.css';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SubscriptionModal({ isOpen, onClose }: SubscriptionModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const plans = [
    {
      id: 'basic',
      name: 'Basic',
      price: 5,
      description: 'Perfect for getting started',
      icon: () => (
        <div className="w-6 h-6" style={{
          imageRendering: 'pixelated',
          background: `
            linear-gradient(45deg, #facc15 0%, #facc15 25%, transparent 25%, transparent 50%, #facc15 50%, #facc15 75%, transparent 75%, transparent 100%),
            linear-gradient(45deg, #facc15 0%, #facc15 25%, transparent 25%, transparent 50%, #facc15 50%, #facc15 75%, transparent 75%, transparent 100%)
          `,
          backgroundSize: '4px 4px, 4px 4px',
          backgroundPosition: '0 0, 2px 2px',
          maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'%3E%3C/polygon%3E%3C/svg%3E")`,
          maskRepeat: 'no-repeat',
          maskSize: 'contain',
          maskPosition: 'center'
        }} />
      ),
      features: [
        'Up to 5 AI conversations per day',
        'Basic voice interactions',
        'Standard response time',
        'Email support',
        'Basic customization'
      ],
      popular: false,
      color: 'border-gray-200'
    },
    {
      id: 'pro',
      name: 'Pro',
      price: 10,
      description: 'Most popular choice',
      icon: () => (
        <div className="w-6 h-6" style={{
          imageRendering: 'pixelated',
          background: `
            linear-gradient(45deg, #a855f7 0%, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent 100%),
            linear-gradient(45deg, #a855f7 0%, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent 100%)
          `,
          backgroundSize: '4px 4px, 4px 4px',
          backgroundPosition: '0 0, 2px 2px',
          maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2'%3E%3C/polygon%3E%3C/svg%3E")`,
          maskRepeat: 'no-repeat',
          maskSize: 'contain',
          maskPosition: 'center'
        }} />
      ),
      features: [
        'Unlimited AI conversations',
        'Advanced voice interactions',
        'Priority response time',
        'Priority support',
        'Advanced customization',
        'Custom personality training',
        'API access'
      ],
      popular: true,
      color: 'border-blue-500'
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 50,
      description: 'For teams and organizations',
      icon: () => (
        <div className="w-6 h-6" style={{
          imageRendering: 'pixelated',
          background: `
            linear-gradient(45deg, #22c55e 0%, #22c55e 25%, transparent 25%, transparent 50%, #22c55e 50%, #22c55e 75%, transparent 75%, transparent 100%),
            linear-gradient(45deg, #22c55e 0%, #22c55e 25%, transparent 25%, transparent 50%, #22c55e 50%, #22c55e 75%, transparent 75%, transparent 100%)
          `,
          backgroundSize: '4px 4px, 4px 4px',
          backgroundPosition: '0 0, 2px 2px',
          maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 5l4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1 4-4-4-4z'%3E%3C/path%3E%3Cpath d='M5 15s-1 0-1 1-1 4-6 4-6-3-6-4-1-1-1-1'%3E%3C/path%3E%3Cpath d='M19 15s1 0 1 1 1 4 6 4 6-3 6-4 1-1 1-1'%3E%3C/path%3E%3C/svg%3E")`,
          maskRepeat: 'no-repeat',
          maskSize: 'contain',
          maskPosition: 'center'
        }} />
      ),
      features: [
        'Everything in Pro',
        'Team collaboration features',
        'Custom integrations',
        'Dedicated account manager',
        '24/7 phone support',
        'Custom branding',
        'Advanced analytics',
        'White-label options'
      ],
      popular: false,
      color: 'border-purple-500'
    }
  ];

  const handleSelectPlan = async (planId: string) => {
    setIsLoading(true);
    setSelectedPlan(planId);
    
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      // Here you would typically redirect to a payment processor
      alert(`Selected ${plans.find(p => p.id === planId)?.name} plan for $${plans.find(p => p.id === planId)?.price}/month`);
    }, 1000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[650] flex items-start justify-center p-4 overflow-y-auto" style={{ fontFamily: 'Gohufont, monospace' }}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-6xl my-8 z-[700]">
        <Card className="bg-gray-900 border-gray-700 shadow-2xl flex flex-col">
          {/* Header */}
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              {/* Pixelated Credit Card Icon */}
              <div className="w-10 h-10" style={{
                imageRendering: 'pixelated',
                background: `
                  linear-gradient(90deg, #a855f7 0%, #a855f7 100%),
                  linear-gradient(0deg, #a855f7 0%, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent 100%)
                `,
                backgroundSize: '100% 2px, 100% 100%',
                backgroundPosition: '0 0, 0 0',
                maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='square' stroke-linejoin='miter'%3E%3Crect x='1' y='4' width='22' height='16'%3E%3C/rect%3E%3Cline x1='1' y1='10' x2='23' y2='10'%3E%3C/line%3E%3C/svg%3E")`,
                maskRepeat: 'no-repeat',
                maskSize: 'contain',
                maskPosition: 'center'
              }} />
              <CardTitle className="text-2xl text-white" style={{ fontWeight: 'normal', letterSpacing: '-0.5px' }}>Subscription Plans</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Hero Section */}
            <div className="text-center">
              <h3 className="text-xl text-white mb-2" style={{ fontWeight: 'normal' }}>
                Choose Your Plan
              </h3>
              <p className="text-gray-400">
                Unlock the full potential of our AI assistant with our flexible subscription plans.
              </p>
            </div>

            {/* Pricing Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((plan) => {
                const IconComponent = plan.icon;
                const isSelected = selectedPlan === plan.id;
                
                return (
                  <Card 
                    key={plan.id} 
                    className={`relative transition-all duration-200 hover:shadow-lg bg-gray-800 border-gray-700 ${
                      plan.popular 
                        ? 'border-blue-500 shadow-lg scale-105' 
                        : plan.color
                    } ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                        <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm" style={{ fontWeight: 'normal' }}>
                          Most Popular
                        </span>
                      </div>
                    )}
                    
                    <CardHeader className="text-center pb-4">
                      <div className="mx-auto mb-4 p-3 rounded-full bg-gray-700 w-fit">
                        <IconComponent />
                      </div>
                      <CardTitle className="text-xl text-white">{plan.name}</CardTitle>
                      <CardDescription className="text-sm text-gray-400">
                        {plan.description}
                      </CardDescription>
                      <div className="mt-4">
                        <span className="text-4xl text-white" style={{ fontWeight: 'normal' }}>${plan.price}</span>
                        <span className="text-gray-400">/month</span>
                      </div>
                    </CardHeader>
                    
                    <CardContent className="pt-0">
                      <ul className="space-y-3 mb-6">
                        {plan.features.map((feature, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm text-gray-300">{feature}</span>
                          </li>
                        ))}
                      </ul>
                      
                      <Button 
                        className={`w-full ${
                          plan.popular 
                            ? 'bg-blue-500 hover:bg-blue-600' 
                            : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                        onClick={() => handleSelectPlan(plan.id)}
                        disabled={isLoading && selectedPlan === plan.id}
                      >
                        {isLoading && selectedPlan === plan.id ? (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Processing...
                          </div>
                        ) : (
                          `Choose ${plan.name}`
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* FAQ Section */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h4 className="text-lg text-white mb-4" style={{ fontWeight: 'normal' }}>Frequently Asked Questions</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h5 className="text-white mb-1" style={{ fontWeight: 'normal' }}>Can I change plans anytime?</h5>
                  <p className="text-sm text-gray-400">
                    Yes, you can upgrade or downgrade your plan at any time.
                  </p>
                </div>
                <div>
                  <h5 className="text-white mb-1" style={{ fontWeight: 'normal' }}>Is there a free trial?</h5>
                  <p className="text-sm text-gray-400">
                    We offer a 14-day free trial for all plans.
                  </p>
                </div>
                <div>
                  <h5 className="text-white mb-1" style={{ fontWeight: 'normal' }}>What payment methods do you accept?</h5>
                  <p className="text-sm text-gray-400">
                    We accept all major credit cards and PayPal.
                  </p>
                </div>
                <div>
                  <h5 className="text-white mb-1" style={{ fontWeight: 'normal' }}>Can I cancel anytime?</h5>
                  <p className="text-sm text-gray-400">
                    Yes, you can cancel your subscription at any time.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
