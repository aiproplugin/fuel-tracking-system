/*
  Warnings:

  - Added the required column `liters` to the `odometer_exception` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "odometer_exception" ADD COLUMN     "liters" DECIMAL(10,2) NOT NULL;
