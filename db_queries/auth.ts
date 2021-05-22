import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import dotenv from 'dotenv';
import autoBind from 'auto-bind';
import { v4 as uuidv4 } from 'uuid';
import { Conn } from '../db/conn';
import { Helpers } from '../utils/helpers';
import Token from '../models/token.model';
import Tokens from '../models/tokens.model';
import User from '../models/user.model';

const helpers: Helpers = new Helpers();
const conn: Conn = new Conn();
const pool = conn.pool;
dotenv.config();

export class Auth {
  constructor() {
    autoBind(this);
  }

  async signUp(request: Request, response: Response): Promise<void> {
    const { name, email, password }: User = request.body;
    if (!email || !password) {
      response.status(400).send({'message': 'Some values are missing'});
      return ;
    }
    if (!helpers.isValidEmail(email)) {
      response.status(400).send({'message': 'Please enter a valid email address'});
      return ;
    }
    
    try {
      const hashPassword: string = helpers.hashPassword(password);  
      const createQuery: string = `INSERT INTO 
        users (id, name, email, password) 
        VALUES ($1, $2, $3, $4) 
        returning *`;
      const values: Array<string> = [
        uuidv4(),
        name,
        email,
        hashPassword
      ];
      const { rows }: pg.QueryResult = await pool.query(createQuery, values);
      const userId: string = rows[0].id;
      const tokens: Tokens = await this.setTokens(userId);
      response.status(201).send(tokens);
    } catch (error) {
      response.status(400).send(error);
    }
  }

  async login(request: Request, response: Response): Promise<void> {
    const { email, password }: User = request.body;
    if (!email || !password) {
      response.status(400).send({'message': 'Some values are missing'});
      return ;
    }
    if (!helpers.isValidEmail(email)) {
      response.status(400).send({'message': 'Please enter a valid email address'});
      return ;
    }
    
    try {
      const loginQuery: string = 'SELECT * FROM users WHERE email = $1';
      const { rows }: pg.QueryResult = await pool.query(loginQuery, [email]);
      if (!rows[0]) {
        response.status(400).send({'message': 'The credentials you provided are incorrect'});
        return ;
      }
      if (!helpers.comparePassword(rows[0].password, password)) {
        response.status(400).send({'message': 'The credentials you provided are incorrect'});
        return ;
      }
      const userId: string = rows[0].id;
      const tokens: Tokens = await this.setTokens(userId);
      response.status(201).send(tokens);
    } catch (error) {
      response.status(400).send(error);
    }
  }
  
  async setTokens(userId: string): Promise<Tokens> {
    const accessToken: string = helpers.generateAccessToken(userId);
    const refreshToken: string = helpers.generateRefreshToken(userId);
    await this.setRefreshToken(userId, refreshToken);
    return {
      userId: userId,
      accessToken: accessToken,
      refreshToken: refreshToken
    }
  }

  async setRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const getQuery: string = 'SELECT * FROM refresh_tokens WHERE user_id = $1';
    const { rows }: pg.QueryResult = await pool.query(getQuery, [userId]);
    if (!rows[0]) {
      await this.insertRefreshToken(userId, refreshToken);
    } else {
      await this.updateRefreshToken(userId, refreshToken);
    }
  }

  async insertRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const insertQuery: string = `INSERT INTO 
      refresh_tokens (user_id, refresh_token) 
      VALUES ($1, $2)`;
    const values: Array<string> = [
      userId,
      refreshToken
    ];     
    await pool.query(insertQuery, values);
  }

  async updateRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const updateQuery: string = `UPDATE refresh_tokens SET refresh_token = $1 WHERE user_id = $2`;
    const values: Array<string> = [
      refreshToken,
      userId
    ];      
    await pool.query(updateQuery, values);
  }

  async revokeRefreshToken(userId: string): Promise<void> {
    const deleteQuery: string = 'DELETE FROM refresh_tokens WHERE user_id = $1';
    await pool.query(deleteQuery, [userId]);
  }  

  async logout(request: Request, response: Response): Promise<void> {
    const { id }: User = request.body;
    try {
      await this.revokeRefreshToken(id);
      response.status(200).json()
    } catch (error) {
      response.status(400).send(error);
    }    
  }  

  async verifyAccessToken(request: Request, response: Response, next: NextFunction): Promise<void> {
    const { name, email, password }: User = request.body;
    if (!request.headers.authorization) {
      response.status(400).send({'message': 'Token is not provided'});
      return ;
    }  
    const token: string = request.headers.authorization.replace('Bearer ','');
    if (!token) {
      response.status(400).send({'message': 'Token is not provided'});
      return ;
    }
    try {
      const decoded: string | object = await jwt.verify(token, process.env.JWT_SECRET_KEY as string);
      const usersQuery: string = 'SELECT * FROM users WHERE id = $1';
      const { rows }: pg.QueryResult = await pool.query(usersQuery, [(decoded as Token).userId]);
      if (!rows[0]) {
        response.status(400).send({'message': 'The token you provided is invalid'});
        return ;
      }
      request.user = { id: (decoded as Token).userId, name: name, email: email, password: password };
      next();
    } catch (error) {
      response.status(400).send(error);
    }
  }

  async getAccessToken(request: Request, response: Response): Promise<void> {
    const userId: string = request.query.userId as string;
    const refreshToken: string = request.query.refreshToken as string;
    try {
      const getQuery: string = 'SELECT * FROM refresh_tokens WHERE user_id = $1 AND refresh_token = $2';
      const { rows }: pg.QueryResult = await pool.query(getQuery, [userId, refreshToken]);
      if (rows[0]) {
        const tokens: Tokens = await this.setTokens(userId);
        response.status(201).send(tokens);
      } else {
        this.revokeRefreshToken(userId);
        response.status(401).send({'message': 'Refresh token is invalid'});
      }      
    } catch (error) {
      response.status(400).send(error);
    } 
  }
}