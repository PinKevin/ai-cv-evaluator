import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Document {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 300, type: 'character varying' })
  originalName: string;

  @Column({ length: 300, type: 'character varying' })
  fileName: string;

  @Column({ type: 'character varying' })
  path: string;
}
