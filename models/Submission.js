import mongoose from 'mongoose';

const SubmissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'completed'],
      default: 'draft',
    },
    currentStep: { type: Number, default: 1 },
    personalData: {
      age: Number,
      gender: String,
      diabetesType: String,
      diabetesDurationYears: Number,
      bloodSugarLevel: Number,
      hba1c: Number,
      bloodPressure: String,
      smoker: String,
      additionalNotes: String,
    },
    leftEyeImage: { type: String }, // base64 data URL
    rightEyeImage: { type: String }, // base64 data URL
    completedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.models.Submission ||
  mongoose.model('Submission', SubmissionSchema);
