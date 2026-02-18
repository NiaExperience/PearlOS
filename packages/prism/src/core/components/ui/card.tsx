import * as React from "react"

import { cn } from "./utils"

/**
 * Card Component
 *
 * A styled container component with rounded borders, shadow effects, and customizable classes.
 *
 * @param className - Additional CSS classes for customization.
 * @param props - Standard HTML div attributes.
 * @returns JSX Element representing the Card.
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border bg-card text-card-foreground shadow-sm",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

/**
 * CardHeader Component
 *
 * Represents the header section of the Card, typically containing the title or summary.
 *
 * @param className - Additional CSS classes for customization.
 * @param props - Standard HTML div attributes.
 * @returns JSX Element representing the CardHeader.
 */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

/**
 * CardTitle Component
 *
 * Displays the title within the CardHeader.
 *
 * @param className - Additional CSS classes for customization.
 * @param props - Standard HTML heading attributes.
 * @returns JSX Element representing the CardTitle.
 */
const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

/**
 * CardDescription Component
 *
 * Provides a description or summary within the CardHeader.
 *
 * @param className - Additional CSS classes for customization.
 * @param props - Standard HTML paragraph attributes.
 * @returns JSX Element representing the CardDescription.
 */
const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

/**
 * CardContent Component
 *
 * Encapsulates the main content area of the Card.
 *
 * @param className - Additional CSS classes for customization.
 * @param props - Standard HTML div attributes.
 * @returns JSX Element representing the CardContent.
 */
const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

/**
 * CardFooter Component
 *
 * Represents the footer section of the Card, typically containing actions or links.
 *
 * @param className - Additional CSS classes for customization.
 * @param props - Standard HTML div attributes.
 * @returns JSX Element representing the CardFooter.
 */
const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

// Export all Card sub-components for use in other parts of the application
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } 