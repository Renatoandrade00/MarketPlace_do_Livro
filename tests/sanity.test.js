import { describe, test, expect } from 'vitest';

describe('Sanity Tests - Step 1.1', () => {
  test('Express imports correctly', () => {
    const express = require('express');
    expect(express).toBeDefined();
    expect(typeof express).toBe('function');
  });

  test('Prisma client imports correctly', () => {
    const { PrismaClient } = require('@prisma/client');
    expect(PrismaClient).toBeDefined();
  });

  test('TensorFlow.js imports and initializes correctly', () => {
    const tf = require('@tensorflow/tfjs');
    expect(tf).toBeDefined();
    expect(tf.tensor).toBeDefined();
    
    // Simple sanity test for tensor operations
    const tensor = tf.tensor1d([1, 2, 3]);
    expect(tensor.shape[0]).toBe(3);
    tensor.dispose();
  });

  test('Zod validates correctly', () => {
    const { z } = require('zod');
    const schema = z.object({
      id: z.number().int().positive(),
      nome: z.string()
    });

    const result = schema.safeParse({ id: 1, nome: 'Teste' });
    expect(result.success).toBe(true);

    const failResult = schema.safeParse({ id: -5, nome: 123 });
    expect(failResult.success).toBe(false);
  });

  test('Groq SDK imports correctly', () => {
    const Groq = require('groq-sdk');
    expect(Groq).toBeDefined();
  });

  test('Helmet and Cors import correctly', () => {
    const helmet = require('helmet');
    const cors = require('cors');
    expect(helmet).toBeDefined();
    expect(cors).toBeDefined();
  });
});
