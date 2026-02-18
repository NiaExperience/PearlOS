/**
 * Prism Data Bridge: Credential Management System
 * 
 * Secure, flexible, and testable credential management for all data sources.
 * Supports environment variables, secret providers, and runtime registration.
 */
import { getLogger } from '../core/logger';
const log = getLogger('prism:data:credentials');

export interface DataSourceCredentials {
  type: 'postgres' | 'mongodb' | 'mysql' | 'openapi' | 'graphql';
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  connectionString?: string;
  schema?: string;
  ssl?: boolean;
  // API-specific fields
  baseUrl?: string;
  apiKey?: string;
  bearerToken?: string;
  // Secret references
  secretRef?: string;
  passwordSecretRef?: string;
  apiKeySecretRef?: string;
  tokenSecretRef?: string;
  // Additional configuration
  [key: string]: any;
}

export interface SecretProvider {
  name: string;
  resolve(secretRef: string): Promise<string>;
}

export interface CredentialResolverOptions {
  providers?: SecretProvider[];
  allowEnvironmentFallback?: boolean;
  logSecretAccess?: boolean;
}

/**
 * Secure credential resolution with support for multiple providers
 */
export class CredentialResolver {
  private providers: SecretProvider[] = [];
  private allowEnvironmentFallback: boolean = true;
  private logSecretAccess: boolean = false;

  constructor(options: CredentialResolverOptions = {}) {
    this.providers = options.providers || [];
    this.allowEnvironmentFallback = options.allowEnvironmentFallback ?? true;
    this.logSecretAccess = options.logSecretAccess ?? false;
  }

  /**
   * Add a secret provider
   */
  addProvider(provider: SecretProvider): void {
    this.providers.push(provider);
  }

  /**
   * Resolve a secret reference to its actual value
   */
  async resolveSecret(secretRef: string): Promise<string> {
    if (this.logSecretAccess) {
      log.info('Resolving secret', { secretRef });
    }

    // 1. Check environment variables first (for testing and local dev)
    if (this.allowEnvironmentFallback && process.env[secretRef]) {
      if (this.logSecretAccess) {
        log.info('Found secret in environment', { secretRef });
      }
      return process.env[secretRef]!;
    }

    // 2. Try secret providers
    for (const provider of this.providers) {
      try {
        const value = await provider.resolve(secretRef);
        if (this.logSecretAccess) {
          log.info('Resolved secret via provider', { provider: provider.name, secretRef });
        }
        return value;
      } catch (error) {
        if (this.logSecretAccess) {
          log.warn('Provider failed to resolve secret', { provider: provider.name, secretRef, error });
        }
        // Continue to next provider
      }
    }

    throw new Error(`Secret not found for ref: ${secretRef}`);
  }

  /**
   * Resolve all secrets in a data source configuration
   */
  async resolveCredentials(config: DataSourceCredentials): Promise<DataSourceCredentials> {
    const resolved = { ...config };

    // Resolve password if secretRef is provided
    if (config.passwordSecretRef) {
      resolved.password = await this.resolveSecret(config.passwordSecretRef);
      delete resolved.passwordSecretRef;
    }

    // Resolve API key if secretRef is provided
    if (config.apiKeySecretRef) {
      resolved.apiKey = await this.resolveSecret(config.apiKeySecretRef);
      delete resolved.apiKeySecretRef;
    }

    // Resolve bearer token if secretRef is provided
    if (config.tokenSecretRef) {
      resolved.bearerToken = await this.resolveSecret(config.tokenSecretRef);
      delete resolved.tokenSecretRef;
    }

    // Handle legacy secretRef for password
    if (config.secretRef && !resolved.password) {
      resolved.password = await this.resolveSecret(config.secretRef);
      delete resolved.secretRef;
    }

    return resolved;
  }
}

/**
 * Environment-based secret provider (for testing and local development)
 */
export class EnvironmentSecretProvider implements SecretProvider {
  name = 'environment';

  async resolve(secretRef: string): Promise<string> {
    const value = process.env[secretRef];
    if (!value) {
      throw new Error(`Environment variable not found: ${secretRef}`);
    }
    return value;
  }
}

/**
 * AWS Secrets Manager provider
 */
export class AwsSecretsProvider implements SecretProvider {
  name = 'aws-secrets-manager';

  constructor(private region?: string) {
    this.region = region || process.env.AWS_REGION || 'us-east-1';
  }

  async resolve(secretRef: string): Promise<string> {
    if (!secretRef.startsWith('aws:')) {
      throw new Error(`Invalid AWS secret reference format: ${secretRef}`);
    }

    // Extract ARN from aws:arn:aws:secretsmanager:...
    const arn = secretRef.substring(4);
    
    try {
      // TODO: Implement AWS SDK integration
      // const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
      // const client = new SecretsManager({ region: this.region });
      // const response = await client.getSecretValue({ SecretId: arn });
      // return response.SecretString || '';
      
      throw new Error('AWS Secrets Manager integration not implemented');
    } catch (error) {
      throw new Error(`Failed to resolve AWS secret ${arn}: ${error}`);
    }
  }
}

/**
 * GCP Secret Manager provider
 */
export class GcpSecretsProvider implements SecretProvider {
  name = 'gcp-secret-manager';

  constructor(private projectId?: string) {
    this.projectId = projectId || process.env.GOOGLE_CLOUD_PROJECT;
  }

  async resolve(secretRef: string): Promise<string> {
    if (!secretRef.startsWith('gcp:')) {
      throw new Error(`Invalid GCP secret reference format: ${secretRef}`);
    }

    const secretName = secretRef.substring(4);
    
    try {
      // TODO: Implement GCP SDK integration
      // const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
      // const client = new SecretManagerServiceClient();
      // const [version] = await client.accessSecretVersion({
      //   name: `projects/${this.projectId}/secrets/${secretName}/versions/latest`
      // });
      // return version.payload.data.toString();
      
      throw new Error('GCP Secret Manager integration not implemented');
    } catch (error) {
      throw new Error(`Failed to resolve GCP secret ${secretName}: ${error}`);
    }
  }
}

/**
 * HashiCorp Vault provider
 */
export class VaultSecretsProvider implements SecretProvider {
  name = 'vault';

  constructor(
    private vaultUrl: string = process.env.VAULT_URL || 'http://localhost:8200',
    private token?: string
  ) {
    this.token = token || process.env.VAULT_TOKEN;
  }

  async resolve(secretRef: string): Promise<string> {
    if (!secretRef.startsWith('vault:')) {
      throw new Error(`Invalid Vault secret reference format: ${secretRef}`);
    }

    const secretPath = secretRef.substring(6);
    
    try {
      // TODO: Implement Vault SDK integration
      // const vault = require('node-vault');
      // const client = vault({
      //   apiVersion: 'v1',
      //   endpoint: this.vaultUrl,
      //   token: this.token
      // });
      // const result = await client.read(secretPath);
      // return result.data.value;
      
      throw new Error('Vault integration not implemented');
    } catch (error) {
      throw new Error(`Failed to resolve Vault secret ${secretPath}: ${error}`);
    }
  }
}

/**
 * Test configuration helper for local development and testing
 */
export class TestCredentialHelper {
  /**
   * Create a test configuration for local PostgreSQL
   */
  static createLocalPostgresConfig(): DataSourceCredentials {
    return {
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'testdb',
      username: process.env.POSTGRES_USER || 'postgres',
      passwordSecretRef: 'POSTGRES_PASSWORD',
      schema: process.env.POSTGRES_SCHEMA || 'public',
      ssl: process.env.POSTGRES_SSL === 'true'
    };
  }

  /**
   * Create a test configuration for local MongoDB
   */
  static createLocalMongoConfig(): DataSourceCredentials {
    return {
      type: 'mongodb',
      connectionString: process.env.MONGO_URL || 'mongodb://localhost:27017/nia_test',
      database: process.env.MONGO_DB || 'nia_test'
    };
  }

  /**
   * Create a test configuration for external API
   */
  static createApiConfig(): DataSourceCredentials {
    return {
      type: 'openapi',
      baseUrl: process.env.API_BASE_URL || 'https://api.example.com',
      apiKeySecretRef: 'API_KEY'
    };
  }

  /**
   * Validate that all required environment variables are set
   */
  static validateTestEnvironment(): string[] {
    const required = [
      'POSTGRES_HOST',
      'POSTGRES_DB', 
      'POSTGRES_USER',
      'POSTGRES_PASSWORD'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      log.warn('Missing environment variables for testing', { missing });
      log.warn('Configure .env.local for testing environment variables');
    }

    return missing;
  }
}

/**
 * Migration script credential helper
 */
export class MigrationCredentialHelper {
  /**
   * Get credentials for migration script
   */
  static async getMigrationCredentials(): Promise<DataSourceCredentials> {
    const resolver = new CredentialResolver({
      allowEnvironmentFallback: true,
      logSecretAccess: true
    });

    const config = TestCredentialHelper.createLocalPostgresConfig();
    return await resolver.resolveCredentials(config);
  }

  /**
   * Validate migration environment
   */
  static validateMigrationEnvironment(): boolean {
    const missing = TestCredentialHelper.validateTestEnvironment();
    return missing.length === 0;
  }
}

/**
 * Runtime registration helper
 */
export class RuntimeCredentialHelper {
  /**
   * Register a new data source with secure credential handling
   */
  static async registerDataSource(
    config: DataSourceCredentials,
    resolver: CredentialResolver
  ): Promise<DataSourceCredentials> {
    // Validate that secrets are referenced, not stored
    if (config.password && !config.passwordSecretRef) {
      throw new Error('Passwords must be stored as secret references, not plaintext');
    }

    if (config.apiKey && !config.apiKeySecretRef) {
      throw new Error('API keys must be stored as secret references, not plaintext');
    }

    // Resolve credentials
    const resolved = await resolver.resolveCredentials(config);
    
    // Log registration (without sensitive data)
    log.info('Registered data source', { type: config.type, host: resolved.host, baseUrl: resolved.baseUrl });
    
    return resolved;
  }

  /**
   * Update data source credentials
   */
  static async updateDataSourceCredentials(
    dataSourceId: string,
    updates: Partial<DataSourceCredentials>,
    resolver: CredentialResolver
  ): Promise<Partial<DataSourceCredentials>> {
    // Validate updates don't contain plaintext secrets
    if (updates.password && !updates.passwordSecretRef) {
      throw new Error('Cannot update to plaintext password');
    }

    if (updates.apiKey && !updates.apiKeySecretRef) {
      throw new Error('Cannot update to plaintext API key');
    }

    // Resolve any new secret references
    const resolved = await resolver.resolveCredentials(updates as DataSourceCredentials);
    
    log.info('Updated data source credentials', { dataSourceId });
    
    return resolved;
  }
} 