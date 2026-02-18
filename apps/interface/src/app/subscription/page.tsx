'use client';

import { ArrowLeft, Check, Star, Zap, Crown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@interface/components/ui/card';
import '@interface/features/Notes/styles/notes.css';

export default function SubscriptionPage() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const plans = [
    {
      id: 'basic',
      name: 'Basic',
      price: 5,
      description: 'Perfect for getting started',
      icon: Star,
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
      icon: Zap,
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
      icon: Crown,
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

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: 'Gohufont, monospace' }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <h1 className="text-2xl text-gray-900" style={{ fontWeight: 'normal' }}>Subscription Plans</h1>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-3xl text-gray-900 mb-4" style={{ fontWeight: 'normal' }}>
            Choose Your Plan
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Unlock the full potential of our AI assistant with our flexible subscription plans. 
            Start with Basic or go Pro for unlimited access.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {plans.map((plan) => {
            const IconComponent = plan.icon;
            const isSelected = selectedPlan === plan.id;
            
            return (
              <Card 
                key={plan.id} 
                className={`relative transition-all duration-200 hover:shadow-lg ${
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
                  <div className="mx-auto mb-4 p-3 rounded-full bg-gray-100 w-fit">
                    <IconComponent className="h-6 w-6 text-gray-600" />
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="text-sm text-gray-500">
                    {plan.description}
                  </CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl text-gray-900" style={{ fontWeight: 'normal' }}>${plan.price}</span>
                    <span className="text-gray-500">/month</span>
                  </div>
                </CardHeader>
                
                <CardContent className="pt-0">
                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-gray-600">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <Button 
                    className={`w-full ${
                      plan.popular 
                        ? 'bg-blue-500 hover:bg-blue-600' 
                        : 'bg-gray-900 hover:bg-gray-800'
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
        <div className="bg-white rounded-lg p-8">
          <h3 className="text-xl text-gray-900 mb-6" style={{ fontWeight: 'normal' }}>Frequently Asked Questions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-gray-900 mb-2" style={{ fontWeight: 'normal' }}>Can I change plans anytime?</h4>
              <p className="text-sm text-gray-600">
                Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.
              </p>
            </div>
            <div>
              <h4 className="text-gray-900 mb-2" style={{ fontWeight: 'normal' }}>Is there a free trial?</h4>
              <p className="text-sm text-gray-600">
                We offer a 14-day free trial for all plans. No credit card required to start.
              </p>
            </div>
            <div>
              <h4 className="text-gray-900 mb-2" style={{ fontWeight: 'normal' }}>What payment methods do you accept?</h4>
              <p className="text-sm text-gray-600">
                We accept all major credit cards, PayPal, and bank transfers for Enterprise plans.
              </p>
            </div>
            <div>
              <h4 className="text-gray-900 mb-2" style={{ fontWeight: 'normal' }}>Can I cancel anytime?</h4>
              <p className="text-sm text-gray-600">
                Yes, you can cancel your subscription at any time. You'll continue to have access until the end of your billing period.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
