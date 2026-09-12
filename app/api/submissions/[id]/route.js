import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Submission from '@/models/Submission';
import { getCurrentUser } from '@/lib/session';

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await dbConnect();
  const submission = await Submission.findOne({
    _id: params.id,
    userId: user.userId,
  });
  if (!submission) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ submission });
}

export async function PATCH(request, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await dbConnect();

  const submission = await Submission.findOne({
    _id: params.id,
    userId: user.userId,
  });
  if (!submission) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (submission.status === 'completed') {
    return NextResponse.json(
      { error: 'This response has already been submitted and is locked.' },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { personalData, leftEyeImage, rightEyeImage, currentStep, complete } =
    body;

  if (personalData) {
    submission.personalData = {
      ...(submission.personalData ? submission.personalData.toObject() : {}),
      ...personalData,
    };
  }
  if (leftEyeImage !== undefined) submission.leftEyeImage = leftEyeImage;
  if (rightEyeImage !== undefined) submission.rightEyeImage = rightEyeImage;
  if (currentStep !== undefined) submission.currentStep = currentStep;

  if (complete) {
    if (
      !submission.personalData ||
      !submission.leftEyeImage ||
      !submission.rightEyeImage
    ) {
      return NextResponse.json(
        { error: 'Please complete every step before submitting.' },
        { status: 400 }
      );
    }
    submission.status = 'completed';
    submission.completedAt = new Date();
  }

  await submission.save();
  return NextResponse.json({ submission });
}

export async function DELETE(request, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await dbConnect();
  const submission = await Submission.findOne({
    _id: params.id,
    userId: user.userId,
  });
  if (!submission) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (submission.status === 'completed') {
    return NextResponse.json(
      { error: 'Cannot delete a completed response.' },
      { status: 400 }
    );
  }
  await submission.deleteOne();
  return NextResponse.json({ success: true });
}
