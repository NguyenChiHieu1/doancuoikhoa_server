const asyncHandler = require('express-async-handler')
const { validationResult } = require('express-validator')
const { hashedPassword, comparePassword, generateAccessToken, generateRefreshToken } = require('../middlewares/authorService')
const user = require('../models/user')
const jwt = require('jsonwebtoken')
const sendMail = require('../utils/sendMail')
const crypto = require('crypto')
const Cart = require('../models/cart')
const { deleteImages } = require('../utils/images')

const register = asyncHandler(async (req, res) => {
    const err = validationResult(req);
    if (!err.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    const { email, password, name } = req.body;
    const findEmail = await user.findOne({ email: email })
    if (findEmail) throw new Error('Email already exists!!!')
    const nameAcc = await user.findOne({ name: name })
    if (nameAcc) throw new Error('Nick name already exists!!!')
    const newUser = await user.create({ ...req.body, password: password })
    if (!newUser) throw new Error('User creation failed!!!')
    await Cart.create({
        userId: newUser._id,
        items: []
    })
    return res.status(200).json({
        success: true,
        msg: "AccountUser created successfully!!!"
    })
});

const login = asyncHandler(async (req, res) => {
    const err = validationResult(req);
    if (!err.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }

    const { email, password } = req.body

    const userCheck = await user.findOne({ email: email })
    if (!userCheck) throw new Error('Not find user account')
    if (await comparePassword(password, userCheck.password)) {
        const accessToken = generateAccessToken(userCheck._id, userCheck.role)
        const newRefreshToken = generateRefreshToken(userCheck._id)
        await user.findByIdAndUpdate(userCheck._id, { refreshToken: newRefreshToken, status: true }, { new: true })
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000
        })
        return res.status(200).json({
            success: true,
            token: accessToken,
            role: userCheck.role
        })
    }
    return res.status(400).json({
        success: false,
        errors: [{
            msg: "Mật khẩu không chính xác!!!",
        }]
    })
});

const getInfoUserLogin = asyncHandler(async (req, res) => {
    const { _id } = req.info_user
    const userNew = await user.findById(_id).populate('address')
        // .populate({
        //     path: 'cart',
        //     select: 'items',
        //     populate: ({
        //         path: 'items.discount',
        //         select: 'discount'
        //     })
        // })
        .select('name fullName email avatar phoneNumber dateOfBirth gender address isBlock wishlist')
    if (!userNew) throw new Error('Get current false!!!')
    return res.status(200).json({
        success: true,
        data: userNew
    })
})

//1, Đăng nhập và cấp phát token:

// Khi người dùng đăng nhập, server cấp phát cả access token và refresh token.
// Access token được sử dụng cho các yêu cầu bảo mật.
// Refresh token được lưu trữ an toàn ở phía client (ví dụ: trong cookie hoặc local storage).

//2,Làm mới access token:
// Khi access token hết hạn, client gửi refresh token lên server để yêu cầu cấp mới access token.
// Server kiểm tra tính hợp lệ của refresh token và nếu hợp lệ, cấp phát một access token mới.

const refreshAccessToken = asyncHandler(async (req, res) => {
    //kiem tra ngay het han token o phia client
    const refreshToken = req.cookies.refreshToken;
    // console.log("refreshToken", refreshToken)
    // console.log("req.cookies.refreshToken", req.cookies.refreshToken)

    if (!refreshToken || !cookies.refreshToken) throw new Error('No refresh token in cookies')
    const rs = await jwt.verify(cookie.refreshToken, process.env.JWT_SECRET)

    const userCheck = await user.findOne({ _id: rs._id, refreshToken: refreshToken })
    if (userCheck) {
        res.status(200).json({
            success: true,
            newAccessToken: generateAccessToken(userCheck._id, userCheck.role)
        })
    }
    else {
        res.status(400).json({
            success: false,
            errors: [{
                msg: "Refresh token not matched ",
            }]
        })
    }
})

const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body
    const userCheck = await user.findOne({ email: email })
    if (!userCheck) throw new Error('Account not existed !!!')
    //
    const resetPasswordCode = await crypto.randomBytes(32).toString('hex')
    // console.log(resetPasswordCode)

    const passwordResetToken = crypto.createHash('sha256').update(resetPasswordCode).digest('hex')
    const passwordResetExpires = Date.now() + 15 * 60 * 1000
    const updatePassword = await user.findByIdAndUpdate(userCheck._id, {
        passwordResetToken: passwordResetToken,
        passwordResetExpires: passwordResetExpires
    }, { new: true })
    // gui email
    const html = `Xin vui lòng click vào link dưới đây để thay đổi mật khẩu. Link này sẽ hết hạn sau 15 phút kể từ bây giờ. 
        <a href=${process.env.CLIENT}/user/reset-password/${resetPasswordCode}>Click here</a>`
    const data = {
        email: email,
        html
    }
    const smail = sendMail(data)
    // console.log(smail)
    if (updatePassword) {
        res.status(200).json({
            success: true,
            msg: 'Password reset token sent to your email',
            data: updatePassword
        })
    } else {
        res.status(400).json({
            success: false,
            errors: [{
                msg: "Reset password failed!!!",
            }]
        })
    }
})

const resetPassword = asyncHandler(async (req, res) => {
    const { resetCode } = req.params
    const { password, confirmPassword } = req.body
    // console.log('resetCode', resetCode)
    // console.log('password', password)
    // console.log('confirmPassword', confirmPassword)
    if (!password || !confirmPassword) throw new Error('Missing input')

    const hashedToken = crypto.createHash('sha256').update(resetCode).digest('hex');

    const userCheck = await user.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() } // Kiểm tra token có còn hạn không
    });

    if (!userCheck) {
        return res.status(400).json({
            success: false,
            errors: [{
                msg: "Token is invalid or expired!!!",
            }]
        });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({
            success: false,
            errors: [{
                msg: "Passwords are not the same!!!",
            }]
        });
    }
    userCheck.password = password
    userCheck.passwordResetToken = undefined
    userCheck.passwordChangeAt = Date.now()
    userCheck.passwordResetExpires = undefined

    const savePass = await userCheck.save()
    if (!savePass) throw new Error("Data save failed")
    return res.status(200).json({
        success: true,
        msg: 'Password update successful'
    })
});

const getUser = asyncHandler(async (req, res) => {
    const { role } = req.params;
    const response = await user.find({ role: role }).select('-refreshToken -password -role -passwordResetToken')
    if (!response) throw new Error('Error found user')
    return res.status(200).json({
        success: true,
        data: response,
        length: response.length
    })
})

const updateUser = asyncHandler(async (req, res) => {
    const { _id } = req.info_user
    let { passwordNew, passwordOld } = req.body
    let image = req.file;

    // try {
    // if (Object.keys(req.body).length === 0) throw new Error('Missing inputs')
    const userUpdate = await user.findById(_id);
    // console.log(userUpdate)
    if (!userUpdate) throw new Error('User not found')
    // 
    let updateData = { ...req.body };
    if (passwordNew && passwordOld) {
        // console.log("passwordNew-" + passwordNew + "-passwordOld-" + passwordOld)
        // Kiểm tra xem mật khẩu cũ có khớp với mật khẩu hiện tại không
        const isMatch = await comparePassword(passwordOld, userUpdate.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                msg: "Old password is incorrect!"
            });
        }

        // Băm mật khẩu mới
        updateData.password = await hashedPassword(passwordNew);
    }
    //
    let arrImage = [];
    if (image) {
        if (userUpdate.avatar !== "https://res.cloudinary.com/dr3f3acgx/image/upload/v1724351609/duxt59vn98gdxqcllctt.jpg") {
            arrImage.push(userUpdate.avatar);
            let deleteImageOld = deleteImages(arrImage);
            if (deleteImageOld) console.log("delete image success!")
            else console.log("delete image false!")
        }
        updateData.avatar = image.path;

    }

    const response = await user.findByIdAndUpdate(_id, updateData,
        { new: true }).select('-refreshToken -role -passwordResetToken -isBlock -orderHistory')
    if (!response) throw new Error('Error update info account')
    return res.status(200).json({
        success: true,
        msg: 'Update successfully',
        data: response
    })
    // } catch (error) {
    //     return res.status(400).json({
    //         success: false,
    //         msg: 'Update failed!!!',
    //         error: error.messange
    //     })
    // }
})

const deleteUser = asyncHandler(async (req, res) => {
    const { _id } = req.body
    console.log(req.body)

    if (!_id) throw new Error('Missing inputs')
    const response = await user.findById(_id)
    if (!response) throw new Error('Not found account')
    let arrImage = [];
    if (response.avatar) {
        if (response.avatar !== "https://res.cloudinary.com/dr3f3acgx/image/upload/v1724351609/duxt59vn98gdxqcllctt.jpg") {
            arrImage.push(response.avatar);
            let deleteImageOld = deleteImages(arrImage);
            if (deleteImageOld) {
                console.log("delete image success!")
                await user.findById(_id)
            }
            else console.log("delete image false!")
        }
    }
    return res.status(200).json({
        success: true,
        msg: `Account user with email ${response.email} delete`
    })
})

const logout = asyncHandler(async (req, res) => {
    const { _id } = req.info_user
    const response = await user.findByIdAndUpdate(_id, { refreshToken: '', status: false }, { new: true })
    if (!response) throw new Error('Error logout')
    res.cookie('refreshToken', '', {
        httpOnly: true,
        expires: new Date(0), // Ngày hết hạn trong quá khứ
    });
    return res.status(200).json({
        success: true,
        msg: 'Logout successfully'
    })
})

const wishlist = asyncHandler(async (req, res) => {
    const { _id } = req.info_user;
    const { idProducts } = req.body;  // Assuming you're sending an array of pids

    const response = await user.findByIdAndUpdate(
        _id,
        { $addToSet: { wishlist: { $each: idProducts } } },
        { new: true }
    );
    if (!response) throw new Error('Error wishlist')
    return res.status(200).json({
        success: true,
        msg: 'Add to wishlist successfully',
        data: response
    })
})

const getAccounts = asyncHandler(async (req, res) => {
    const queries = { ...req.query };

    // Fields to exclude from queries
    const excludeFields = ['limit', 'sort', 'page', 'fields'];
    excludeFields.forEach(field => delete queries[field]);

    let queryString = JSON.stringify(queries);
    queryString = queryString.replace(/\b(gte|gt|lt|lte)\b/g, matchedEl => `$${matchedEl}`);
    const formattedQueries = JSON.parse(queryString);

    // Handle 'name' search condition
    if (queries?.name) {
        formattedQueries.name = { $regex: queries.name, $options: 'i' };
    }

    // Create base query for users
    let queryCommand = user.find(formattedQueries)
        .select("-password -refreshToken -passwordChangeAt -passwordResetToken -passwordResetExpires");

    // Handle sorting
    if (req.query.sort) {
        const sortBy = req.query.sort.split(',').join(' ');
        queryCommand = queryCommand.sort(sortBy);
    } else {
        queryCommand = queryCommand.sort({ createdAt: -1 });
    }

    // Handle field selection
    if (req.query.fields) {
        const fields = req.query.fields.split(',').join(' ');
        queryCommand = queryCommand.select(fields);
    }

    // Handle pagination
    const page = +req.query.page || 1;
    const limit = +req.query.limit || process.env.LIMIT_ACCOUNTS;
    const skip = (page - 1) * limit;
    queryCommand.skip(skip).limit(limit);

    try {
        const accountsList = await queryCommand.exec();
        const count = await user.countDocuments(formattedQueries);

        return res.status(200).json({
            success: true,
            counts: count,
            currentPage: page,
            totalPage: Math.ceil(count / limit),
            data: accountsList,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            msg: 'Cannot get user accounts',
            error: err.message
        });
    }
});

const apiSave = asyncHandler(async (req, res) => {
    try {
        // Lấy tất cả dữ liệu từ collection 'user'
        const data = await user.find();

        const savePromises = data.map(async (item) => {
            // item.status = undefined;
            // if (typeof item.status === "string") {
            //     if (item.status.toLowerCase() === "online") {
            //         item.status = true;
            //     } else if (item.status.toLowerCase() === "offline") {
            //         item.status = false;
            //     } else {
            //         item.status = false;
            //     }
            // }
            await item.save();
        });
        await Promise.all(savePromises);

        res.status(200).json({
            success: true,
            msg: 'Data saved successfully',
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            msg: error.message
        })
    }
})

const updateAccount = asyncHandler(async (req, res) => {
    const { id } = req.params;

    let { password } = req.body
    let image = req.file;

    // try {
    const userUpdate = await user.findOne({ _id: id });
    // console.log(userUpdate)
    if (!userUpdate) throw new Error('User not found')
    // 
    let updateData = { ...req.body };
    if (password !== "" || password !== undefined) {
        // console.log(password)
        // Băm mật khẩu mới
        updateData.password = await hashedPassword(password);
    }
    //
    let arrImage = [];
    if (image) {
        if (userUpdate.avatar !== "https://res.cloudinary.com/dr3f3acgx/image/upload/v1724351609/duxt59vn98gdxqcllctt.jpg") {
            arrImage.push(userUpdate.avatar);
            let deleteImageOld = deleteImages(arrImage);
            if (deleteImageOld) console.log("delete image success!")
            else console.log("delete image false!")
        }
        updateData.avatar = image.path;
    }

    const response = await user.findByIdAndUpdate(id, updateData, { new: true });
    if (!response) throw new Error('Error update info account')
    return res.status(200).json({
        success: true,
        msg: 'Update successfully',
        data: response
    })
    // } catch (error) {
    //     return res.status(400).json({
    //         success: false,
    //         msg: 'Update failed!!!',
    //         error: error.messange
    //     })
    // }
})

const createAccount = asyncHandler(async (req, res) => {
    const err = validationResult(req);
    if (!err.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    try {
        let { name, email, password } = req.body
        let image = req.file;

        const findEmail = await user.findOne({ email: email })
        if (findEmail) throw new Error('Email already exists!!!')
        const nameAcc = await user.findOne({ name: name })
        if (nameAcc) throw new Error('Nick name already exists!!!')
        if (image) {
            await user.create({ ...req.body, password: password, avatar: image.path })
        } else {
            await user.create({ ...req.body, password: password })
        }
        return res.status(200).json({
            success: true,
            msg: "AccountUser created successfully!!!"
        })
    } catch (err) {
        return res.status(400).json({
            success: false,
            msg: 'Create account failed!!!',
        })
    }
});

module.exports = {
    register,
    login,
    getInfoUserLogin,
    refreshAccessToken,
    forgotPassword,
    resetPassword,
    getUser,
    updateUser,
    deleteUser,
    logout,
    wishlist,
    getAccounts,
    apiSave,
    updateAccount,
    createAccount
}