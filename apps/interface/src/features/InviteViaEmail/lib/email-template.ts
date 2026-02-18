/**
 * Email template generation for friend invitations
 */

export interface InviteEmailData {
  inviteLink: string;
}

/**
 * Generates the HTML email body for friend invitation
 */
export function generateInviteEmailHtml(data: InviteEmailData): string {
  const { inviteLink } = data;
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You've Been Invited to Pearlos</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #2d1b4e 0%, #1e3a5f 100%);">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); overflow: hidden;">
                <!-- Header with gradient -->
                <tr>
                  <td style="padding: 0; background: linear-gradient(135deg, #6b21a8 0%, #3b82f6 100%); text-align: center;">
                    <div style="padding: 50px 40px;">
                      <h1 style="margin: 0 0 10px; font-size: 48px; font-weight: 700; color: #ffffff; letter-spacing: 2px;">PEARLOS</h1>
                      <p style="margin: 0; font-size: 14px; color: rgba(255,255,255,0.9); letter-spacing: 1px; font-weight: 300;">celebrate at the speed of imagination</p>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <h2 style="margin: 0 0 20px; font-size: 24px; font-weight: 600; color: #1a1a1a; text-align: center;">You've Been Invited! 🎉</h2>
                    
                    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #4a4a4a; text-align: center;">
                      Hello!
                    </p>
                    
                    <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.7; color: #4a4a4a; text-align: center;">
                      A friend has invited you to join <strong style="background: linear-gradient(135deg, #6b21a8 0%, #3b82f6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">Pearlos</strong>, the human-first intelligent environment for creation, collaboration and connection.
                    </p>
                    
                    <!-- CTA Button with gradient -->
                    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                      <tr>
                        <td align="center" style="padding: 0;">
                          <a href="${inviteLink}" style="display: inline-block; padding: 16px 48px; background: linear-gradient(135deg, #a855f7 0%, #3b82f6 100%); color: #ffffff; text-decoration: none; border-radius: 50px; font-size: 16px; font-weight: 600; text-align: center; box-shadow: 0 4px 15px rgba(147, 51, 234, 0.4);">be first in line for early access</a>
                        </td>
                      </tr>
                    </table>
                    
                    <p style="margin: 30px 0 0; font-size: 13px; line-height: 1.6; color: #6b7280; text-align: center;">
                      Or copy and paste this link into your browser:<br>
                      <a href="${inviteLink}" style="color: #6b21a8; text-decoration: none; font-weight: 500;">${inviteLink}</a>
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; background-color: #f9fafb; text-align: center; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0; font-size: 11px; line-height: 1.5; color: #9ca3af;">
                      zero spam. early access only.
                    </p>
                    <p style="margin: 10px 0 0; font-size: 11px; line-height: 1.5; color: #9ca3af;">
                      This invitation was sent from Pearlos. If you didn't expect this invitation, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

/**
 * Generates the plain text email body for friend invitation
 */
export function generateInviteEmailText(data: InviteEmailData): string {
  const { inviteLink } = data;
  
  return `
You've Been Invited to Pearlos!

celebrate at the speed of imagination

Hello!

A friend has invited you to join Pearlos, the human-first intelligent environment for creation, collaboration and connection.

Click the link below to get started:
${inviteLink}

zero spam. early access only.

This invitation was sent from Pearlos. If you didn't expect this invitation, you can safely ignore this email.
  `.trim();
}

